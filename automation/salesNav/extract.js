const { cleanName } = require("../../utils/nameCleaner");

const buildLinkedInUrl = (href) => {
  if (!href) return "";
  const match = href.match(/\/sales\/lead\/([^,?]+)/);
  if (!match) return "";
  return `https://www.linkedin.com/in/${match[1]}`;
};

const extractSalesNavLeads = async (page) => {
  const rawLeads = await page.evaluate(() => {
    const cards = document.querySelectorAll('div[data-x-search-result="LEAD"]');
    const results = [];
    for (const card of cards) {
      const nameEl = card.querySelector('[data-anonymize="person-name"]');
      const titleEl = card.querySelector('[data-anonymize="title"]');
      const companyEl = card.querySelector('[data-anonymize="company-name"]');
      let companyName = (companyEl ? companyEl.textContent : "").trim();
      if (!companyName) {
        const hoverBtn = card.querySelector(
          'button.entity-hovercard__a11y-trigger[aria-label]'
        );
        if (hoverBtn) {
          const label = hoverBtn.getAttribute("aria-label") || "";
          const match = label.match(/^See more about\s+(.+)/i);
          if (match) {
            companyName = match[1].trim();
          }
        }
      }
      if (!companyName) {
        const subtitle = card.querySelector(".artdeco-entity-lockup__subtitle");
        if (subtitle) {
          const middot = subtitle.querySelector(".separator--middot");
          if (middot) {
            let node = middot.nextSibling;
            while (node) {
              if (node.nodeType === 3) {
                const text = node.textContent.trim();
                if (text) {
                  companyName = text;
                  break;
                }
              }
              node = node.nextSibling;
            }
          }
        }
      }
      const locationEl = card.querySelector('[data-anonymize="location"]');
      const profileLink = card.querySelector(
        'a[data-control-name="view_lead_panel_via_search_lead_name"]'
      );
      results.push({
        rawName: (nameEl ? nameEl.textContent : "").trim(),
        title: (titleEl ? titleEl.textContent : "").trim(),
        companyName,
        location: (locationEl ? locationEl.textContent : "").trim(),
        href: profileLink ? profileLink.getAttribute("href") : "",
      });
    }
    return results;
  });

  return rawLeads.map((lead) => {
    const cleaned = cleanName(lead.rawName);
    const parts = cleaned.split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    const fullName = cleaned;
    return {
      fullName,
      firstName,
      lastName,
      title: lead.title,
      companyName: lead.companyName,
      location: lead.location,
      linkedInUrl: buildLinkedInUrl(lead.href),
      domains: [],
    };
  });
};

module.exports = { extractSalesNavLeads };
