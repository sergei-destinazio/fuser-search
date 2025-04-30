window.fsAttributes = window.fsAttributes || [];
window.fsAttributes.push([
  'cmsload',
  (listInstances) => {
    window.isFuseListLoaded = true;
  },
]);

document.addEventListener("DOMContentLoaded", function () {
  // Get UI elements by data attributes
  const input = document.querySelector('[data-fuse-element="input"]'); // input field
  const container = document.querySelector('[data-fuse-element="list"]'); // list container
  let allItems = Array.from(container.querySelectorAll(".w-dyn-item")); // all list items
  const itemMap = new Map(); // map for quick DOM access by item id

  const clearButton = document.querySelector('[data-fuse-element="clear-button"]'); // clear button
  const noResultsElement = document.querySelector('[data-fuse-element="no-results"]'); // "no results" block
  const initialElement = document.querySelector('[data-fuse-element="initial-element"]'); // initial state block

  // Pagination setup
  let currentPage = 1; // current page number
  const controls = document.querySelector('[data-fuse-element="pagination"]'); // pagination container
  const resultsPerPage = controls ? +controls.getAttribute('data-fuse-items-per-page') : 10; // items per page
  const controlPageButtons = document.querySelector('[data-fuse-element="pagination-page-buttons"]'); // page buttons
  const controlPrevButton = document.querySelector('[data-fuse-element="prev"]'); // previous page button
  const controlNextButton = document.querySelector('[data-fuse-element="next"]'); // next page button

  // Setup for excerpt (text snippet to display in results)
  const excerptSource = document.querySelector('[data-fuse-element="excerpt-source"]');
  let excerptField;
  if (excerptSource) {
    excerptField = excerptSource.getAttribute("data-fuse-field");
  }

  // Clear button functionality
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      input.value = "";     // clear the input field
      currentPage = 1;      // reset to first page
      updateList();         // refresh the list
    });
  }

  // Get searchable field names from the first item
  let fields = [];
  if (allItems.length > 0) {
    allItems[0].querySelectorAll("[data-fuse-field]").forEach((field) => {
      fields.push(field.getAttribute("data-fuse-field"));
    });
  }

  prepareUi(); // Prepare UI before search starts

  // Function to update search data from the DOM
  let data = updateData();
  function updateData() {
    allItems = Array.from(container.querySelectorAll(".w-dyn-item")); // get current items
    return allItems.map((item) => {
      const id = item.getAttribute("data-fuse-id"); // get item ID
      let result = { id };
      fields.forEach((field) => {
        const el = item.querySelector(`[data-fuse-field="${field}"]`);
        const elText = el ? el.innerText.trim() : "";
        result[field] = elText; // store text of each field
      });
      itemMap.set(id, item); // map item ID to its DOM element

      return result;
    });
  }

  // Periodically update data and Fuse collection
  let dataUpdates = setInterval(() => {
    data = updateData();             // refresh data
    fuse.setCollection(data);       // update Fuse collection
    if (input.value || controls) updateList(); // run search again if needed

    // Stop updating once fully loaded
    if (window.isFuseListLoaded) clearInterval(dataUpdates);

    // Remove temporary data-fuse-item attributes
    container.querySelectorAll('[data-fuse-item]').forEach((el) => {
      el.removeAttribute("data-fuse-item");
    });
  }, 1000);

  // Generate Fuse.js key list with weights
  function generateFuseKeys(fields) {
    return fields.map((field) => ({
      name: field,
      weight:
        +document.querySelector(`[data-fuse-field="${field}"]`)?.getAttribute("data-fuse-weight") || 1,
    }));
  }

  // Create Fuse instance with configuration
  const fuse = new Fuse(data, {
    keys: generateFuseKeys(fields), // keys and weights
    threshold: 0.4,                 // match sensitivity (lower = stricter)
    distance: 100,                  // how far matches can be
    ignoreLocation: true,          // ignore match position
    includeMatches: true,          // include match details
    includeScore: true,            // include match score
  });

  // Initial UI state setup before any search
  function prepareUi() {
    if (noResultsElement) noResultsElement.style.display = "none"; // hide "no results"
    if (initialElement) container.style.display = "none";          // hide list
    if (initialElement && controls) controls.style.display = "none"; // hide pagination

    // Remove initial state markers
    document.querySelectorAll('[fuse-initial-hidden]').forEach((el) => {
      el.removeAttribute("fuse-initial-hidden");
    });
  }
  // Highlight matching words in text
  function highlightText(text, words) {
    // Escape special characters and create a case-insensitive regex pattern for all words
    const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    // Wrap each match with a span tag for highlighting
    return text.replace(pattern, '<span data-fuse-highlight>$1</span>');
  }

  // Generate excerpt around the first matching word
  function getExcerpt(description, words) {
    const lowerDesc = description.toLowerCase();
    let matchIndex = -1;
    let foundWord = "";

    // Try to find exact match of any word
    for (const word of words) {
      const idx = lowerDesc.indexOf(word.toLowerCase());
      if (idx !== -1) {
        matchIndex = idx;
        foundWord = word;
        break;
      }
    }

    // If no exact match found, try partial match using the first 3 letters
    if (matchIndex === -1 && words.length) {
      for (const word of words) {
        const prefix = word.slice(0, 3);
        const re = new RegExp(prefix, "i");
        const m = description.match(re);
        if (m && m.index !== undefined) {
          matchIndex = m.index;
          foundWord = m[0];
          break;
        }
      }
    }

    let excerpt = "";

    // If a match was found, extract surrounding text as excerpt
    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - 40);
      const end = Math.min(description.length, matchIndex + 40);
      excerpt = description.slice(start, end);
      if (start > 0) excerpt = "..." + excerpt;
      if (end < description.length) excerpt += "...";
    } else {
      // If no match found, use beginning of the description
      excerpt = description.slice(0, 80);
      if (description.length > 80) excerpt += "...";
    }

    // Highlight found words inside the excerpt
    return highlightText(excerpt, words);
  }

  // Name of the title field to prioritize if it exists
  const titleField = "title";

  // Main smart search function with prioritization logic
  function searchSmart(query) {
    // List of common words to ignore in search
    const stopWords = new Set([
      "a", "an", "the", "is", "of", "in", "at", "on", "to", "for", "with", "and", "or",
      "does", "how", "what", "can", "do"
    ]);

    // Clean and split query into significant words
    const words = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    const resultMap = new Map();
    const fullResults = fuse.search(query);

    // First pass: store full query matches
    fullResults.forEach((res) => {
      const id = res.item.id;
      resultMap.set(id, {
        item: res.item,
        scoreSum: res.score,
        count: 1,
        fullMatch: true,
        matchedWords: new Set(),
        matchedInTitle: false,
      });
    });

    // Second pass: store partial matches per word
    words.forEach((word) => {
      const results = fuse.search(word);
      results.forEach((res) => {
        const id = res.item.id;
        if (!resultMap.has(id)) {
          resultMap.set(id, {
            item: res.item,
            scoreSum: 0,
            count: 0,
            fullMatch: false,
            matchedWords: new Set(),
            matchedInTitle: false,
          });
        }
        const entry = resultMap.get(id);
        entry.scoreSum += res.score;
        entry.count += 1;
        entry.matchedWords.add(word);
        // Mark if word was found in the title field
        if (fields.includes(titleField) && res.item[titleField]?.toLowerCase().includes(word)) {
          entry.matchedInTitle = true;
        }
      });
    });

    // Transform and sort results by relevance
    return Array.from(resultMap.values())
      .map((entry) => ({
        item: entry.item,
        averageScore: entry.scoreSum / entry.count,
        fullMatch: entry.fullMatch,
        matchedCount: entry.matchedWords.size,
        matchedInTitle: entry.matchedInTitle,
      }))
      .sort((a, b) => {
        // Sort by title match > number of matched words > full match > average score
        if (a.matchedInTitle && !b.matchedInTitle) return -1;
        if (!a.matchedInTitle && b.matchedInTitle) return 1;
        if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
        if (a.fullMatch && !b.fullMatch) return -1;
        if (!a.fullMatch && b.fullMatch) return 1;
        return a.averageScore - b.averageScore;
      });
  }

  // Debounce utility to limit how often search is triggered
  function debounce(func, delay) {
    let timeout;
    return function (...args) {
      currentPage = 1; // always reset to first page when typing
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  }

  // Listen to input changes with debounce
  input.addEventListener("input", debounce(updateList, 400));

  function updateList() {
    const query = input.value.trim();

    // Hide all items before rendering results
    allItems.forEach((el) => {
      if (query === "") {
        el.removeAttribute("style");
        el.classList.remove("is-fuse-visible");
      } else {
        el.style.display = "none";
        el.classList.remove("is-fuse-visible");
      }
    });

    // If input is empty, reset to initial state
    if (initialElement && query === "") {
      container.style.display = "none";
      if (noResultsElement) noResultsElement.style.display = "none";
      initialElement.removeAttribute("style");
      if (controls) controls.style.display = "none";
      return;
    }

    const results = searchSmart(query);
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    // Show "no results" block if search has no matches
    if (noResultsElement && query !== "" && !results.length) {
      container.style.display = "none";
      if (initialElement) initialElement.style.display = "none";
      noResultsElement.removeAttribute("style");
      if (controls) controls.style.display = "none";
      return;
    }

    // Show results
    if (noResultsElement) noResultsElement.style.display = "none";
    if (initialElement) initialElement.style.display = "none";
    container.removeAttribute("style");

    // If pagination is enabled, render paginated results
    if (controls) {
      results.length ? renderPaginatedResults(results, words) : renderAllPaginatedItems();
    } else {
      // Otherwise, render all matching results or reset
      query ? renderResults(results, words) : renderAllItems();
    }
  }

  // Renders the list of results based on Fuse.js search
  function renderResults(results, words) {
    results.forEach((res) => {
      const el = itemMap.get(res.item.id);
      if (!el) return;

      el.removeAttribute("style");
      el.classList.add("is-fuse-visible");

      // Highlight matched words inside fields
      fields.forEach((field) => {
        const fieldEl = el.querySelector(`[data-fuse-field="${field}"]`);
        if (fieldEl) {
          fieldEl.innerHTML = highlightText(res.item[field], words);
        }
      });

      // Render excerpt if enabled
      if (excerptField) {
        const excerptContainer = el.querySelector('[data-fuse-element="excerpt-container"]');
        if (excerptContainer) {
          excerptContainer.innerHTML = `<p>${getExcerpt(res.item[excerptField], words)}</p>`;
        }
      }

      container.appendChild(el);
    });
  }

  // Renders all items without filtering, used for the initial state or reset
  function renderAllItems() {
    data.forEach((res) => {
      const el = itemMap.get(res.id);
      if (!el) return;

      // Remove existing highlights
      container.querySelectorAll('[data-fuse-highlight]').forEach((el) => el.removeAttribute('data-fuse-highlight'));

      // Clear excerpt if present
      if (excerptField) {
        const excerptContainer = el.querySelector('[data-fuse-element="excerpt-container"]');
        if (excerptContainer) {
          excerptContainer.innerHTML = '';
        }
      }

      container.appendChild(el);
    });
  }

  // Render only paginated items based on search results
  function renderPaginatedResults(results, words) {
    const totalPages = Math.ceil(results.length / resultsPerPage);
    const start = (currentPage - 1) * resultsPerPage;
    const end = start + resultsPerPage;
    let paginated = results.slice(start, end);

    // Hide all items initially
    allItems.forEach((el) => {
      el.style.display = "none";
      el.classList.remove("is-fuse-visible");
    });

    controls.removeAttribute("style");

    if (paginated.length) {
      paginated.forEach((res) => {
        const el = itemMap.get(res.item.id);
        if (!el) return;
        el.style.display = "";
        el.classList.add("is-fuse-visible");

        // Highlight fields
        fields.forEach((field) => {
          const fieldEl = el.querySelector(`[data-fuse-field="${field}"]`);
          if (fieldEl) {
            fieldEl.innerHTML = highlightText(res.item[field], words);
          }
        });

        // Render excerpt if needed
        if (excerptField) {
          const excerptContainer = el.querySelector('[data-fuse-element="excerpt-container"]');
          if (excerptContainer) {
            excerptContainer.innerHTML = `<p>${getExcerpt(res.item[excerptField], words)}</p>`;
          }
        }

        container.appendChild(el);
      });
    }

    // Update pagination buttons
    renderPaginationControls(totalPages);
  }

  // Render paginated items when no search query is active
  function renderAllPaginatedItems() {
    const totalPages = Math.ceil(data.length / resultsPerPage);
    const start = (currentPage - 1) * resultsPerPage;
    const end = start + resultsPerPage;
    let paginated = data.slice(start, end);

    // Hide all items first
    allItems.forEach((el) => {
      el.style.display = "none";
      el.classList.remove("is-fuse-visible");
    });

    controls.removeAttribute("style");

    paginated.forEach((res) => {
      const el = itemMap.get(res.id);
      if (!el) return;
      el.style.display = "";
      el.classList.add("is-fuse-visible");

      // Clear previous highlights
      container.querySelectorAll('[data-fuse-highlight]').forEach((el) => el.removeAttribute('data-fuse-highlight'));

      // Clear excerpt if present
      if (excerptField) {
        const excerptContainer = el.querySelector('[data-fuse-element="excerpt-container"]');
        if (excerptContainer) {
          excerptContainer.innerHTML = '' // <p>${res[excerptField].length > 80 ? res[excerptField].slice(0, 80) + "…" : res[excerptField]}</p>;
        }
      }

      container.appendChild(el);
    });

    renderPaginationControls(totalPages);
  }

  // Pagination controls: next/prev buttons
  if (controlPrevButton && controlNextButton) {
    controlNextButton.addEventListener('click', () => {
      currentPage++
      updateList();
    });
    controlPrevButton.addEventListener('click', () => {
      currentPage--
      updateList();
    });
  }

  // Render "..." in pagination
  function appendDots() {
    const dots = document.createElement("div");
    dots.textContent = "...";
    dots.classList.add("fuse-page-dots");
    controlPageButtons.appendChild(dots);
  };

  // Renders the actual pagination buttons
  function renderPaginationControls(totalPages) {

    // Hide or show "next" button
    if (currentPage === totalPages) {
      controlNextButton.style.display = "none";
    } else {
      controlNextButton.removeAttribute("style");
    }

    // Hide or show "previous" button
    if (currentPage === 1) {
      controlPrevButton.style.display = "none";
    } else {
      controlPrevButton.removeAttribute("style");
    }

    if (!controls) return;
    controlPageButtons.innerHTML = "";

    // Loop through and render pagination buttons
    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement("button");
      btn.textContent = i;
      btn.classList.add("fuse-page-button");
      if (i === currentPage) btn.classList.add("is-fuse-current");

      btn.addEventListener("click", () => {
        currentPage = i;
        updateList();
      });

      // Only render specific buttons for cleaner pagination
      if (i === 1 ||
        i === totalPages ||
        i === currentPage ||
        (currentPage === 1 && (i === 2 || i === 3)) ||
        (currentPage === 2 && (i === 3)) ||
        (currentPage === totalPages && (i === totalPages - 1 || i === totalPages - 2)) ||
        (currentPage === totalPages - 1 && (i === totalPages - 2))
      ) {
        controlPageButtons.appendChild(btn);
      }

      // Add ellipsis when needed
      if ((currentPage > 2 && i === 1 ||
        currentPage < totalPages - 1 && i === totalPages - 1) && (totalPages > 5)
      ) {
        appendDots();
      }
    }
  }

  // Prevent form submit
  input.closest("form").addEventListener("submit", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
});
