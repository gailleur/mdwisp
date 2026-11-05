// Highlights the visitor's platform, shows the current version and how
// often the installers have been downloaded. Runs entirely in the browser;
// the only requests are for this site's own /latest.json, the release
// manifest the app's update check reads too, and /downloads.json, GitHub's
// public download counts added up per platform.
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
  // The store button is in the page for everyone and shown to Mac visitors.
  var store = document.getElementById("store");
  if (store && os === "mac") store.hidden = false;
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

(function () {
  var line = document.getElementById("counts");
  if (!line || typeof fetch !== "function") return;
  var names = [["mac", "macOS"], ["windows", "Windows"], ["linux", "Linux"]];
  var figure = function (n) {
    var b = document.createElement("b");
    b.textContent = n.toLocaleString();
    return b;
  };
  fetch("/downloads.json", { cache: "no-cache" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (counts) {
      var per = counts && counts.platforms;
      if (!per || typeof counts.total !== "number" || !(counts.total > 0)) return;
      var when = counts.since ? new Date(counts.since) : null;
      var month = when && !isNaN(when.getTime())
        ? when.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        : "";
      line.textContent = "";
      line.append("Downloaded ", figure(counts.total), " times" + (month ? " since " + month : "") + ": ");
      names.forEach(function (pair, i) {
        var n = per[pair[0]];
        if (typeof n !== "number") n = 0;
        line.append((i ? " · " : "") + pair[1] + " ", figure(n));
      });
      line.append(". Counted by GitHub each time an installer file is fetched, updates included. The app itself reports nothing.");
      line.hidden = false;
    })
    .catch(function () { /* the line simply stays hidden */ });
})();
