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
    document.querySelectorAll('[fuse-initial-state="true"]').forEach((el) => {
      el.removeAttribute('fuse-initial-state');
    });
  }

  // Find fuzzy matching to highlight
  function levenshteinDistance(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }

  // Highlight matching words in text
function highlightWords(text, queryWords, maxDistance = 2) {
  const wordsWithIndices = [];
  const wordRegex = /\b\w+\b/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    wordsWithIndices.push({
      word: match[0],
      index: match.index,
    });
  }

  const matches = [];

  for (const { word, index } of wordsWithIndices) {
    const lowerWord = word.toLowerCase();

    for (const query of queryWords) {
      const lowerQuery = query.toLowerCase();

      // (1) Exact match (short queries)
      if (query.length < 5 && lowerWord === lowerQuery) {
        matches.push({ index, length: word.length });
        break;
      }

      // (2) Includes
      if (query.length > 3 && lowerWord.includes(lowerQuery)) {
        const start = lowerWord.indexOf(lowerQuery);
        matches.push({ index: index + start, length: query.length });
        break;
      }

      // (3) Fuzzy match (find closest matching window)
      if (query.length >= 5) {
        let bestDist = Infinity;
        let bestStart = -1;
        let bestLen = -1;

        for (let start = 0; start < lowerWord.length; start++) {
          for (let len = 2; len <= lowerWord.length - start; len++) {
            const sub = lowerWord.slice(start, start + len);
            const dist = levenshteinDistance(sub, lowerQuery);
            if (dist < bestDist || (dist === bestDist && len > bestLen)) {
              bestDist = dist;
              bestStart = start;
              bestLen = len;
            }
          }
        }

        if (bestDist <= maxDistance && bestStart !== -1) {
          matches.push({ index: index + bestStart, length: bestLen });
          break;
        }
      }
    }
  }

  // Remove overlaps and sort
  const nonOverlapping = matches
    .sort((a, b) => a.index - b.index)
    .filter((match, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return match.index >= prev.index + prev.length;
    });

  // Highlight
  let highlighted = "";
  let lastIndex = 0;

  for (const match of nonOverlapping) {
    highlighted += text.slice(lastIndex, match.index);
    highlighted += `<span data-fuse-highlight>${text.slice(match.index, match.index + match.length)}</span>`;
    lastIndex = match.index + match.length;
  }

  highlighted += text.slice(lastIndex);
  return highlighted;
}



  // Generate excerpt around the first matching word
  function getExcerpt(description, words, maxDistance = 2) {
    const lowerDesc = description.toLowerCase();
    const lowPriorityWords = new Set([
      "a", "an", "the", "is", "of", "in", "at", "on", "to", "for", "with", "and", "or",
      "does", "how", "what", "can", "do", "you", "your", "are", "am", "could"
    ]);

    const highPriorityWords = [];
    const lowPriorityMatches = [];

    for (const word of words) {
      if (lowPriorityWords.has(word.toLowerCase())) {
        lowPriorityMatches.push(word);
      } else {
        highPriorityWords.push(word);
      }
    }

    // Function for fuzzy-search of similar word in text
    function findFuzzyMatch(wordList) {
      const wordRegex = /\b\w+\b/g;
      let match;
      const descWords = [];

      while ((match = wordRegex.exec(lowerDesc)) !== null) {
        descWords.push({
          word: match[0],
          index: match.index
        });
      }

      for (const { word: targetWord, index } of descWords) {
        const lowerTarget = targetWord.toLowerCase();

        for (const query of wordList) {
          const lowerQuery = query.toLowerCase();

          // Direct match
          if (lowerQuery.length < 5 && lowerTarget === lowerQuery) {
            return { index, word: targetWord };
          }

          // Inclusion in the word
          if (lowerQuery.length > 3 && lowerTarget.includes(lowerQuery)) {
            return { index, word: targetWord };
          }

          // Fuzzy comparison
          if (lowerQuery.length >= 5) {
            for (let i = 0; i <= lowerTarget.length - lowerQuery.length; i++) {
              const sub = lowerTarget.slice(i, i + lowerQuery.length);
              const dist = levenshteinDistance(sub, lowerQuery);
              if (dist <= maxDistance) {
                return { index, word: targetWord };
              }
            }
          }
        }
      }

      return null;
    }

    // Try to find high-priority words
    let matchResult = findFuzzyMatch(highPriorityWords);

    // If didn't find, try low-priority
    if (!matchResult && lowPriorityMatches.length) {
      matchResult = findFuzzyMatch(lowPriorityMatches);
    }

    let excerpt = "";

    if (matchResult) {
      const { index } = matchResult;
      const start = Math.max(0, index - 40);
      const end = Math.min(description.length, index + 40);
      excerpt = description.slice(start, end);
      if (start > 0) excerpt = "..." + excerpt;
      if (end < description.length) excerpt += "...";
    } else {
      // if nothing is found, cut off the beginning
      excerpt = description.slice(0, 80);
      if (description.length > 80) excerpt += "...";
    }

    // Return with backlighting
    return highlightWords(excerpt, words);
  }


  // Name of the title field to prioritize if it exists
  const titleField = "title";

  // Main smart search function with prioritization logic


  function searchSmart(query) {
    const stopWords = new Set([
      "a", "an", "the", "is", "of", "in", "at", "on", "to", "for", "with", "and", "or",
      "does", "how", "what", "can", "do", "you", "your", "are", "am", "could"
    ]);

    const words = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    const shortWords = words.filter((w) => w.length < 5);
    const longWords = words.filter((w) => w.length >= 5);

    const resultMap = new Map(); // for strict matches
    const looseResultMap = new Map(); // for loose matches

    // Fuzzy search for long words
    longWords.forEach((word) => {
      const results = fuse.search(word);
      results.forEach((res) => {
        const id = res.item.id;

        // Strict match
        if (!resultMap.has(id)) {
          resultMap.set(id, {
            item: res.item,
            matchedQueryWords: new Set(),
            scoreSum: 0,
            count: 0,
            matchedInTitle: false,
            fullMatch: false,
          });
        }
        const entry = resultMap.get(id);
        entry.scoreSum += res.score;
        entry.count += 1;
        entry.matchedQueryWords.add(word);
        if (
          fields.includes(titleField) &&
          res.item[titleField]?.toLowerCase().includes(word)
        ) {
          entry.matchedInTitle = true;
        }

        // Also add to loose map
        if (!looseResultMap.has(id)) {
          looseResultMap.set(id, {
            item: res.item,
            matchedQueryWords: new Set(),
            scoreSum: 0,
            count: 0,
            matchedInTitle: false,
            fullMatch: false,
          });
        }
        const looseEntry = looseResultMap.get(id);
        looseEntry.scoreSum += res.score;
        looseEntry.count += 1;
        looseEntry.matchedQueryWords.add(word);
        if (
          fields.includes(titleField) &&
          res.item[titleField]?.toLowerCase().includes(word)
        ) {
          looseEntry.matchedInTitle = true;
        }
      });
    });

    // Exact search for short words
    shortWords.forEach((word) => {
      data.forEach((item) => {
        const haystack = JSON.stringify(item).toLowerCase();
        if (haystack.includes(word)) {
          const id = item.id;

          // Strict
          if (!resultMap.has(id)) {
            resultMap.set(id, {
              item: item,
              matchedQueryWords: new Set(),
              scoreSum: 0,
              count: 0,
              matchedInTitle: false,
              fullMatch: false,
            });
          }
          const entry = resultMap.get(id);
          entry.count += 1;
          entry.matchedQueryWords.add(word);
          if (
            fields.includes(titleField) &&
            item[titleField]?.toLowerCase().includes(word)
          ) {
            entry.matchedInTitle = true;
          }

          // Loose
          if (!looseResultMap.has(id)) {
            looseResultMap.set(id, {
              item: item,
              matchedQueryWords: new Set(),
              scoreSum: 0,
              count: 0,
              matchedInTitle: false,
              fullMatch: false,
            });
          }
          const looseEntry = looseResultMap.get(id);
          looseEntry.count += 1;
          looseEntry.matchedQueryWords.add(word);
          if (
            fields.includes(titleField) &&
            item[titleField]?.toLowerCase().includes(word)
          ) {
            looseEntry.matchedInTitle = true;
          }
        }
      });
    });

    // Full phrase match
    const fullResults = fuse.search(query);
    fullResults.forEach((res) => {
      const id = res.item.id;

      if (!resultMap.has(id)) {
        resultMap.set(id, {
          item: res.item,
          matchedQueryWords: new Set(),
          scoreSum: 0,
          count: 0,
          matchedInTitle: false,
          fullMatch: true,
        });
      }
      const entry = resultMap.get(id);
      entry.scoreSum += res.score;
      entry.count += 1;
      entry.fullMatch = true;

      // Also add to loose matches
      if (!looseResultMap.has(id)) {
        looseResultMap.set(id, {
          item: res.item,
          matchedQueryWords: new Set(),
          scoreSum: 0,
          count: 0,
          matchedInTitle: false,
          fullMatch: true,
        });
      }
      const looseEntry = looseResultMap.get(id);
      looseEntry.scoreSum += res.score;
      looseEntry.count += 1;
      looseEntry.fullMatch = true;
    });

    // Strict: require all words matched
    const strictResults = Array.from(resultMap.values()).filter((entry) =>
      words.every((w) => entry.matchedQueryWords.has(w))
    );

    // Loose: require at least one word matched, and not already in strict
    const strictIds = new Set(strictResults.map((r) => r.item.id));
    const looseResults = Array.from(looseResultMap.values()).filter(
      (entry) => !strictIds.has(entry.item.id) && words.some((w) => entry.matchedQueryWords.has(w))
    );

    const combined = [...strictResults, ...looseResults];

    return combined
      .map((entry) => ({
        item: entry.item,
        averageScore: entry.count > 0 ? entry.scoreSum / entry.count : 1,
        fullMatch: entry.fullMatch,
        matchedCount: entry.matchedQueryWords.size,
        matchedInTitle: entry.matchedInTitle,
      }))
      .sort((a, b) => {
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

    const searchResults = searchSmart(query);
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

    // Sort results
    const results = searchResults.slice().sort((a, b) => {
      const aTitleMatch = words.some((w) => a.item.title?.toLowerCase().includes(w));
      const bTitleMatch = words.some((w) => b.item.title?.toLowerCase().includes(w));

      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;

      const aDescMatch = words.some((w) => a.item.description?.toLowerCase().includes(w));
      const bDescMatch = words.some((w) => b.item.description?.toLowerCase().includes(w));

      if (aDescMatch && !bDescMatch) return -1;
      if (!aDescMatch && bDescMatch) return 1;

      // If both are at the same level, we keep the original order.
      return 0;
    });

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
          fieldEl.innerHTML = highlightWords(res.item[field], words);
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
            fieldEl.innerHTML = highlightWords(res.item[field], words);
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
        currentPage === 3 && i === 2 ||
        (currentPage === 1 && (i === 2 || i === 3)) ||
        (currentPage === 2 && (i === 3)) ||
        (currentPage === totalPages && (i === totalPages - 1 || i === totalPages - 2)) ||
        (currentPage === totalPages - 1 && (i === totalPages - 2)) ||
        (currentPage === totalPages - 2 && (i === totalPages - 1))
      ) {
        controlPageButtons.appendChild(btn);
      }

      // Add ellipsis when needed
      if ((currentPage > 3 && i === 1 ||
        currentPage < totalPages - 2 && i === totalPages - 1) &&
        totalPages > 4
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
