#![allow(clippy::module_name_repetitions)]
#![allow(clippy::module_inception)]

use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

use actix_web::{App, get, HttpRequest, HttpResponse, HttpServer, post, Responder, web};
use sqlx::sqlite::SqlitePoolOptions;
use tracing::{debug, error, info, instrument, Level};
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::config::SAMPLE_CONFIG;
use crate::error::ShortyError;
use crate::util::{generate_random_chars, ensure_http_prefix, uri_to_url};
use crate::link::{LinkConfig, LinkStore};

pub mod util;
pub mod link;
pub mod config;
pub mod error;

const CLEAN_SLEEP_DURATION: Duration = Duration::from_secs(60 * 60);


#[get("/{shortened_url:.*}")]
#[instrument(skip_all)]
async fn get_shortened(
	params: web::Path<String>,
	link_store: web::Data<LinkStore>,
) -> Result<impl Responder, ShortyError> {
	let shortened_url = params.into_inner();
	debug!("Got request for {shortened_url}");

	Ok(
		if let Some(link) = link_store.get(shortened_url.as_str()).await {
			info!("Return url for {shortened_url} is {link}");
			HttpResponse::TemporaryRedirect()
				.append_header(("Location", link.redirect_to.as_str()))
				.finish()
		} else {
			HttpResponse::NotFound().finish()
		}
	)
}

/// The simple create_shortened
#[post("/{url:.*}")]
#[instrument(skip_all)]
async fn create_shortened(
	req: HttpRequest,
	link_store: web::Data<LinkStore>,
	config: web::Data<Config>,
) -> Result<impl Responder, ShortyError> {
	let uri = req.uri();
	info!("URI is {uri}");

	let url = uri_to_url(uri);
	let url = ensure_http_prefix(url);

	let link = link_store.create_link(url).await?;
	let formatted = link.formatted(config.as_ref());
	info!("Shortening URL {} to {}", link.redirect_to, formatted);


	Ok(HttpResponse::Ok().body(formatted))
}

/// Custom shortened URL, configured via Json.
/// Also see [`LinkConfig`]
#[post("/custom")]
async fn create_shortened_custom(
	link_store: web::Data<LinkStore>,
	link_config: web::Json<LinkConfig>,
	config: web::Data<Config>,
) -> Result<impl Responder, ShortyError> {
	let link = link_store.create_link_with_config(link_config.into_inner()).await?;
	let formatted = link.formatted(config.as_ref());
	info!("Shortening URL {} to {}", link.redirect_to, formatted);


	Ok(HttpResponse::Ok().body(formatted))
}

#[get("/assets/{asset:.*}")]
async fn serve_file(asset: web::Path<String>) -> Result<impl Responder, Box<dyn std::error::Error>> {
	// let mut file = fs::File::open(format!()).await;
	// let mut content = String::new();

	debug!("Got request for file: {asset}");


	Ok(HttpResponse::Ok())
}

#[get("/")]
async fn index() -> Result<impl Responder, Box<dyn std::error::Error>> {
	// let mut file = fs::File::open(format!()).await;
	// let mut content = String::new();

	debug!("Index");


	Ok(HttpResponse::Ok())
}

#[tokio::main]
async fn main() -> Result<(), ShortyError> {
	let env_filter = EnvFilter::from_default_env()
		.add_directive(Level::INFO.into())
		.add_directive("shorty=debug".parse().unwrap());

	tracing_subscriber::fmt()
		.with_env_filter(env_filter)
		.with_line_number(true)
		.with_file(true)
		.init();

	let config;
	{
		let config_location = std::env::var("SHORTY_CONFIG")
			.unwrap_or_else(|_| "./config.toml".to_owned());
		let path = Path::new(&config_location);

		if !path.exists() {
			let mut file = std::fs::File::create(path).expect("Failed to create sample config file");
			file.write_all(SAMPLE_CONFIG.as_bytes()).expect("Couldn't write the sample config file");

			error!(
				"You have to configure the config file. A sample config was created at {}",
				config_location
			);
			std::process::exit(1);
		}

		let mut file = std::fs::File::open(path).expect("Failed to open config file.");
		let mut content = String::new();
		file.read_to_string(&mut content).expect("Failed to read config file.");

		config = Config::new(content.as_str()).expect("Failed to parse config");
	}

	let config = web::Data::new(config);
	let config_clone = config.clone();

	let pool = SqlitePoolOptions::new()
		.max_connections(5)
		.min_connections(1)
		.max_lifetime(Some(Duration::from_secs(60 * 60)))
		.connect(config.database_url.as_str())
		.await?;

	sqlx::migrate!()
		.run(&pool)
		.await
		.expect("Failed db schema migration.");

	let links = web::Data::new(LinkStore::new(pool.clone()));
	let links_clone = links.clone();

	tokio::task::spawn(async move {
		loop {
			if let Err(why) = links_clone.clean().await {
				error!("{why}");
			}
			tokio::time::sleep(CLEAN_SLEEP_DURATION).await;
		}
	});

	let pool = web::Data::new(pool);
	info!("Starting server at {}:{}", config.listen_url, config.port);

	HttpServer::new(move ||
		App::new()
			.app_data(config_clone.clone())
			.app_data(links.clone())
			.app_data(pool.clone())
			.service(index)
			.service(serve_file)
			.service(get_shortened)
			.service(create_shortened_custom)
			.service(create_shortened)
	)
		.bind((config.listen_url.as_str(), config.port))
		.expect("Failed to bind port or listen address.")
		.run()
		.await
		.expect("Error running the HTTP server.");


	Ok(())
}
