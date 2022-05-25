const shorten_class = "shorten";
const copy_class = "copy";
const copied_class = "copied";
const validation_class = "validatable";

const error = "error";
const warning = "warning";
const info = "info";

const shortenField = document.getElementById("shorten_textfield");
const shortenButton = document.getElementById("shorten_button");
const advancedMode = document.getElementById("advanced_mode");
const maxUses = document.getElementById("max_uses");
const ageDays = document.getElementById("age_days");
const advancedInputs = document.getElementsByClassName('advanced_mode');
const customIdField = document.getElementById("custom_id");
const boxList = document.getElementById("box_list");
const messageBox = document.getElementById("message_box");
const shortenButtonText = shortenButton.value;

// set constraints on field
{
	let xhr = new XMLHttpRequest();
	let configLocation = getEndpointUrl("/config");
	xhr.open('GET', configLocation, true);
	xhr.responseType = 'json';
	xhr.onload = () => {
		if (xhr.status === 200) {
			handleConfig(xhr.response)
		} else {
			message(xhr.status + ": " + xhr.responseText);
		}
	};
	xhr.send();
}

maxUses.max = 2 ** 63 - 1;
maxUses.min = 0;

// sets the date input minimum date to exactly now
{
	const date = new Date();
	date.setMilliseconds(date.getMilliseconds() - (date.getTimezoneOffset() * 1000 * 60));
	ageDays.min = date.toISOString().split(".")[0];
}

// Add keylistener to the textfield so we can also submit on enter
shortenField.addEventListener("keypress", preventDefaultEnter);
shortenField.oninput = shortenField.onfocus = () => {
	shortenField.classList.add(validation_class);
	setButtonMode(shorten_class);
};
//shortenField.addEventListener("paste", () => { setButtonMode(shorten_class); });
shortenButton.addEventListener("click", handleShortenClick);
advancedMode.addEventListener("click", advancedModeSwitchHandler);

function handleShortenClick(event) {
	shortenField.classList.add(validation_class);

	if (getButtonMode() === copy_class) {
		navigator.clipboard.writeText(shortenField.value);
		setButtonMode(copied_class);
		setTimeout(() => {
			if (getButtonMode() === copy_class) {
				setButtonMode(copy_class);
			}
		}, 2000);
		return;
	}

	if (!((advancedFieldsValid() || !advancedMode.checked) && shortenField.checkValidity())) {
		let invalidFields = "";
		let numberWords = ["is", "it"];

		if (!shortenField.checkValidity()) {
			invalidFields += "url ";
		}
		// invalidFields = invalidFields.charAt(0).toUpperCase() + invalidFields.slice(1);
		// invalidFields = invalidFields.slice(0, -2);

		if (!maxUses.checkValidity() && advancedMode.checked) {
			invalidFields += "and max usages";
			numberWords = ["are", "them"]
		}

		message(invalidFields + " " + numberWords[0] + " invalid, check " + numberWords[1] + " and try again.", error);

		return;
	}

	clearMessages();

	const xhr = new XMLHttpRequest();
	const url = getEndpointUrl("/custom");
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.onreadystatechange = () => {
		// Check if request is completed
		if (xhr.readyState !== 4) {
			return;
		}
		// Response successful
		if (xhr.status === 200) {
			handleSuccess(xhr.responseText)
		} else if (xhr.status === 409) { // Conflict
			handleConflict();
		} else {
			message(xhr.status + ": " + xhr.responseText);
		}
	}

	const data = {};
	data["link"] = shortenField.value;

	if (maxUses.value !== '') {
		data["max_uses"] =  - 0;
	}

	if (ageDays.value !== '') {
		let now = new Date();
		let date = Date.parse(ageDays.value);
		data["valid_for"] = date - now.getTime();
	}

	if (customIdField.value !== '') {
		data["custom_id"] = customIdField.value;
	}

	xhr.send(JSON.stringify(data))
}

function advancedFieldsValid() {
	return ageDays.checkValidity() && maxUses.checkValidity() && customIdField.checkValidity();
}

function getButtonMode() {
	const classes = shortenButton.className.split(" ");

	let mode = classes.find((c) => {
		return c === shorten_class || c === copy_class || c === copied_class;
	});

	if (mode === copied_class) {
		mode = copy_class;
	}

	return mode;
}

function setButtonMode(mode) {
	shortenButton.classList.remove(shorten_class, copy_class, copied_class);
	shortenButton.classList.add(mode);

	let text;

	if (mode === copy_class) {
		text = "Copy";
	} else if (mode === shorten_class) {
		text = shortenButtonText;
	} else if (mode === copied_class) {
		text = "Copied!";
	}

	shortenButton.value = text;
}

function preventDefaultEnter(event) {
	if (event.key === "Enter") {
		event.preventDefault();
		return;
	}
}

function getEndpointUrl(endpoint) {
	return window.location.origin + endpoint;
}

function advancedModeSwitchHandler(event) {
	for (let i = 0; i < advancedInputs.length; i++) {
		if (advancedMode.checked) {
			advancedInputs[i].style.display = "inherit";
		} else {
			advancedInputs[i].style.display = "none";
		}
	}
}

function message(message, type) {
	const box = messageBox.content.firstElementChild.cloneNode(true);
	box.classList.add(type)
	box.innerText = message;
	boxList.appendChild(box)
}

function clearMessages() {
	boxList.replaceChildren();
}

function handleConfig(config) {
	shortenField.maxLength = config.max_link_length;
	customIdField.maxLength = config.max_custom_id_length;
}

function handleSuccess(response) {
	setButtonMode(copy_class);
	shortenField.value = response;
}

function handleConflict() {
	message("Custom Id:" + customIdField.value + " already used. Try something different", error);
}