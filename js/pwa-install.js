(function () {
  "use strict";

  let installPrompt = null;
  let lastMessage = "";
  const SINGLE_FILE_RELEASE = "2026.08.03.10";

  function isInstalled() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches
      || window.navigator.standalone === true;
  }

  function platformHelp() {
    const agent = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/i.test(agent)) {
      return "In Safari, tap Share, then Add to Home Screen.";
    }
    if (/Firefox/i.test(agent)) {
      return "Firefox desktop does not offer PWA installation. Open Nyx in Chrome or Edge to install it.";
    }
    if (/Safari/i.test(agent) && !/Chrome|Chromium|Edg/i.test(agent)) {
      return "In Safari, choose File, then Add to Dock.";
    }
    return "Use the install icon in the browser address bar, or open the browser menu and choose Install Nyx.";
  }

  function installCard(kind) {
    const card = document.createElement("section");
    card.dataset.nyxInstallCard = "true";
    card.className = kind === "legacy" ? "settings-card" : "settings-block";
    const copy = `
      <h2>Install Nyx</h2>
      <p data-install-nyx-status>Installs Nyx as an app with its own window and desktop icon.</p>`;
    const control = `<div class="settings-actions nyx-install-actions">
      <button class="${kind === "legacy" ? "" : "settings-action"}" data-install-nyx type="button">Install Nyx</button>
      <button class="${kind === "legacy" ? "" : "settings-action"}" data-download-nyx-singlefile type="button">Download Single File</button>
    </div>`;
    card.innerHTML = kind === "dashboard"
      ? `<div class="nyx-settings-copy">${copy}</div><div class="nyx-settings-control">${control}</div>`
      : `${copy}${control}`;
    return card;
  }

  function ensureInstallCards() {
    document.querySelectorAll(".browser-only-settings.nyx-settings-dashboard").forEach((app) => {
      if (app.querySelector("[data-nyx-install-card]")) return;
      const group = app.querySelector('[data-settings-category="advanced"] .nyx-settings-group');
      if (group) group.prepend(installCard("dashboard"));
    });

    document.querySelectorAll(".browser-only-settings .settings-section.active").forEach((section) => {
      if (section.querySelector("[data-nyx-install-card]")) return;
      const card = installCard("browser");
      const displayHeading = [...section.querySelectorAll("h2")]
        .find((heading) => heading.textContent.trim() === "Display Mode");
      const displayCard = displayHeading?.closest(".settings-block");
      if (displayCard) displayCard.after(card);
      else section.append(card);
    });

    document.querySelectorAll(".settings-panel").forEach((panel) => {
      if (panel.querySelector("[data-nyx-install-card]")) return;
      const grids = panel.querySelectorAll(":scope > .settings-grid");
      const target = grids[1] || grids[0];
      if (target) target.prepend(installCard("legacy"));
    });
  }

  function updateControls(message = lastMessage) {
    lastMessage = message;
    ensureInstallCards();
    const installed = isInstalled();
    document.querySelectorAll("[data-install-nyx]").forEach((button) => {
      button.disabled = installed;
      button.setAttribute("aria-disabled", String(installed));
      const label = installed ? "Nyx is Installed" : "Install Nyx";
      if (button.textContent !== label) button.textContent = label;
    });
    document.querySelectorAll("[data-install-nyx-status]").forEach((status) => {
      const text = installed
        ? "Nyx is installed on this device and opens in its own app window."
        : message || (installPrompt
          ? "Ready to install on this device."
          : "Installs Nyx as an app with its own window and desktop icon.");
      if (status.textContent !== text) status.textContent = text;
    });
  }

  async function requestInstall() {
    if (isInstalled()) {
      updateControls();
      return;
    }
    if (!installPrompt) {
      updateControls(platformHelp());
      return;
    }

    const prompt = installPrompt;
    installPrompt = null;
    try {
      const result = await prompt.prompt();
      updateControls(result?.outcome === "accepted"
        ? "Finishing the Nyx installation..."
        : "Installation was cancelled. You can try again anytime.");
    } catch {
      updateControls(platformHelp());
    }
  }

  function downloadSingleFile(button) {
    const source = new URL("/nyx-singlefile.html", window.location.href);
    source.searchParams.set("release", SINGLE_FILE_RELEASE);
    source.searchParams.set("fresh", Date.now().toString(36));
    const previousLabel = button?.textContent || "Download Single File";
    if (button) {
      button.disabled = true;
      button.textContent = "Downloading…";
    }
    const link = document.createElement("a");
    link.href = source.href;
    link.download = "Nyx-Single-File.html";
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    const status = button?.closest("[data-nyx-install-card]")?.querySelector("[data-install-nyx-status]");
    if (status) status.textContent = "The latest Chrome-compatible Nyx file is downloading.";
    window.setTimeout(() => {
      if (button) {
        button.disabled = false;
        button.textContent = previousLabel;
      }
    }, 500);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateControls("Ready to install on this device.");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    updateControls();
  });

  document.addEventListener("click", (event) => {
    const downloadButton = event.target.closest?.("[data-download-nyx-singlefile]");
    if (downloadButton) {
      event.preventDefault();
      downloadSingleFile(downloadButton);
      return;
    }
    const button = event.target.closest?.("[data-install-nyx]");
    if (!button) return;
    event.preventDefault();
    requestInstall();
  }, true);

  const observer = new MutationObserver(() => updateControls());
  function start() {
    updateControls();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.NyxInstall = {
    request: requestInstall,
    downloadSingleFile,
    refresh: updateControls,
    get available() {
      return Boolean(installPrompt);
    },
    get installed() {
      return isInstalled();
    }
  };
})();
