// Highlights the visitor's platform. Runs entirely in the browser; the page
// makes no requests beyond its own files.
(function () {
  var ua = navigator.userAgent;
  var os = /Mac/.test(ua) ? "mac" : /Win/.test(ua) ? "win" : /Linux|X11/.test(ua) ? "linux" : null;
  if (!os) return;
  var row = document.querySelector('tr[data-os="' + os + '"]');
  if (!row) return;
  row.classList.add("current");
  var first = row.querySelector("a");
  var primary = document.getElementById("primary");
  var note = document.getElementById("primary-note");
  if (first && primary) {
    primary.href = first.href;
    primary.textContent = "Download for " + row.querySelector("th").textContent;
  }
  if (note) note.textContent = (os === "mac" ? "Apple silicon. " : "") + "Free. Apache License 2.0.";
})();
