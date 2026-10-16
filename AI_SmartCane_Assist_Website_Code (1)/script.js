const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("siteNav");

menuToggle.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.textContent = isOpen ? "Close" : "Menu";
});

siteNav.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.textContent = "Menu";
  });
});

const speakButton = document.getElementById("speakButton");
const obstacleSelect = document.getElementById("obstacleSelect");
const speechStatus = document.getElementById("speechStatus");

speakButton.addEventListener("click", () => {
  const phrase = obstacleSelect.value;
  if (!("speechSynthesis" in window)) {
    speechStatus.textContent = "Speech playback is not supported in this browser. You can still read the selected sample cue: " + phrase;
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.rate = 0.9;
  utterance.onstart = () => { speechStatus.textContent = "Playing sample cue: " + phrase; };
  utterance.onend = () => { speechStatus.textContent = "Sample cue finished."; };
  utterance.onerror = () => { speechStatus.textContent = "Unable to play audio. Please check your browser settings."; };
  window.speechSynthesis.speak(utterance);
});

document.getElementById("routeButton").addEventListener("click", () => {
  const destination = document.getElementById("destinationInput").value.trim();
  const routeStatus = document.getElementById("routeStatus");
  if (!destination) {
    routeStatus.textContent = "Please enter a destination first.";
    document.getElementById("destinationInput").focus();
    return;
  }
  routeStatus.textContent = "Opening a map search for " + destination + ". This is not live navigation.";
  const mapsUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(destination);
  window.open(mapsUrl, "_blank", "noopener,noreferrer");
});

document.getElementById("sosButton").addEventListener("click", () => {
  const preview = document.getElementById("sosPreview");
  const willShow = preview.hidden;
  preview.hidden = !willShow;
  document.getElementById("sosButton").textContent = willShow ? "Hide SOS preview" : "Preview SOS message";
});
