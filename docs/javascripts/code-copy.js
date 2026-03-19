document.addEventListener("DOMContentLoaded", () => {
  const blocks = document.querySelectorAll("div.codehilite");

  for (const block of blocks) {
    if (block.querySelector(".rl-code-copy-btn")) continue;

    const pre = block.querySelector("pre");
    const code = block.querySelector("code");
    if (!pre || !code) continue;

    if (getComputedStyle(block).position === "static") {
      block.style.position = "relative";
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rl-code-copy-btn";
    button.setAttribute("aria-label", "Copy code");
    button.title = "Copy code";
    button.textContent = "Copy";

    button.addEventListener("click", async () => {
      const text = code.innerText;
      try {
        await navigator.clipboard.writeText(text);
        const prev = button.textContent;
        button.textContent = "Copied";
        button.classList.add("is-copied");
        window.setTimeout(() => {
          button.textContent = prev;
          button.classList.remove("is-copied");
        }, 1200);
      } catch {
        button.textContent = "Failed";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      }
    });

    block.appendChild(button);
  }
});
