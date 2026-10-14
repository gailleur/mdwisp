// Highlights the visitor's platform and shows the current version. Runs
// entirely in the browser; the only request is for this site's own
// /latest.json, the release manifest the app's update check reads too.
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

(function () {
  var line = document.getElementById("version");
  if (!line || typeof fetch !== "function") return;
  fetch("/latest.json", { cache: "no-cache" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (manifest) {
      if (!manifest || typeof manifest.version !== "string") return;
      var when = manifest.pub_date ? new Date(manifest.pub_date) : null;
      var day = when && !isNaN(when.getTime())
        ? when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
        : "";
      var link = document.createElement("a");
      link.href = "https://github.com/gailleur/mdwisp/releases/tag/v" + manifest.version;
      link.textContent = "release notes";
      line.textContent = "Latest version " + manifest.version + (day ? ", released " + day : "") + " · ";
      line.appendChild(link);
      line.hidden = false;
    })
    .catch(function () { /* the line simply stays hidden */ });
})();
