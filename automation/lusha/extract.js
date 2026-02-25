const { waitForAnyVisible, waitForSalesNavReady } = require("../utils/dom");
const { clickLushaBadge } = require("./actions");
const { cleanName } = require("../../utils/nameCleaner");

const extractDomains = (text) => {
  if (!text) {
    return [];
  }
  const matches = String(text).match(/@([a-z0-9.-]+\.[a-z]{2,})/gi) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/^@/, "").toLowerCase())));
};

const getLushaFrame = (page) => {
  return (
    page.frames().find((f) => {
      const url = f.url() || "";
      return f.name() === "LU__extension_iframe" || url.includes("lusha");
    }) || null
  );
};

const expandAllCards = async (target) => {
  // Click expand arrows multiple times to handle animations
  for (let round = 0; round < 3; round++) {
    await target.evaluate(() => {
      const arrows = Array.from(
        document.querySelectorAll(
          '.divider-and-arrow-container img[alt="Arrow Down"], .divider-and-arrow-container'
        )
      );
      arrows.forEach((el) => {
        const clickable = el.closest(".divider-and-arrow-container") || el;
        if (clickable) {
          clickable.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
          );
        }
      });
    });
    await target.waitForTimeout(200);
  }
};

const extractLushaContacts = async (
  page,
  { timeoutMs = 20000, maxCards = 25, debug = true, retryOnTimeout = true } = {}
) => {
  const t0 = Date.now();
  if (debug) {
    console.log(`[lusha] start (timeout=${timeoutMs}ms, maxCards=${maxCards})`);
  }
  const tReadyStart = Date.now();
  await waitForSalesNavReady(page, timeoutMs);
  if (debug) {
    console.log(`[lusha] waitForSalesNavReady ${Date.now() - tReadyStart}ms`);
  }

  const run = async (target) => {
    const containerSelectors = [
      "[data-test-id='bulk-contact-container-with-data']",
      ".bulk-contact-profile-container",
    ];
    const tVisible = Date.now();
    try {
      await waitForAnyVisible(target, containerSelectors, timeoutMs);
    } catch (error) {
      if (retryOnTimeout) {
        if (debug) {
          console.log("[lusha] container not visible, retrying by clicking Lusha badge");
        }
        await clickLushaBadge(page, Math.min(8000, timeoutMs));
        await waitForAnyVisible(target, containerSelectors, timeoutMs);
      } else {
        throw error;
      }
    }
    if (debug) {
      console.log(`[lusha] waitForAnyVisible ${Date.now() - tVisible}ms`);
    }
    const tExpand = Date.now();
    await expandAllCards(target);
    if (debug) {
      console.log(`[lusha] expandAllCards ${Date.now() - tExpand}ms`);
    }
    const tScript = Date.now();
    const raw = await target.evaluate((mc) => {
      const cards = Array.from(
        document.querySelectorAll(".bulk-contact-profile-container")
      );
      return cards.slice(0, mc).map((card) => {
        const fullNameEl = card.querySelector(".bulk-contact-full-name");
        const companyEl = card.querySelector(".bulk-contact-company-name");
        const fullName = fullNameEl ? fullNameEl.textContent.trim() : "";
        const companyName = companyEl ? companyEl.textContent.trim() : "";
        const spans = Array.from(
          card.querySelectorAll(
            ".bulk-contact-value-text .user-base.overflow-span"
          )
        );
        const domainTexts = spans
          .map((span) => (span.textContent || "").trim())
          .filter(Boolean);
        return { fullName, companyName, domainTexts };
      });
    }, maxCards);
    if (debug) {
      console.log(`[lusha] evaluate ${Date.now() - tScript}ms, raw=${raw.length}`);
    }

    const tMap = Date.now();
    const mapped = raw.map((record) => {
      // ✅ Use cleanName for consistent name cleaning
      const cleaned = cleanName(record.fullName);
      const parts = cleaned.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";

      const domains = [];
      for (const text of record.domainTexts || []) {
        const extracted = extractDomains(text);
        for (const d of extracted) {
          if (!domains.includes(d)) {
            domains.push(d);
          }
        }
      }
      return {
        fullName: cleaned,
        firstName,
        lastName,
        companyName: record.companyName,
        domains,
      };
    });
    if (debug) {
      console.log(`[lusha] mapRecords ${Date.now() - tMap}ms`);
    }
    return mapped;
  };

  const lushaFrame = getLushaFrame(page);
  const tFrame = Date.now();
  const result = lushaFrame ? await run(lushaFrame) : await run(page);
  if (debug) {
    console.log(
      `[lusha] total ${Date.now() - t0}ms (frame=${lushaFrame ? "yes" : "no"}, results=${result.length})`
    );
  }
  return result;
};

module.exports = {
  extractLushaContacts,
  extractDomains,
};
