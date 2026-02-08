import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { BrowserMultiFormatReader } from "@zxing/library";
import Papa from "papaparse";

const DEFAULT_API_BASE =
  process.env.REACT_APP_API_BASE ||
  ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:4000"
    : "");

const defaultForm = {
  title: "",
  issueNumber: "",
  publisher: "",
  grade: "",
  signatureStatus: "none",
  slabStatus: "raw",
  isKey: false,
  coverUrl: "",
  barcode: "",
  notes: "",
  synopsis: "",
};

const signatureLabels = {
  none: "None",
  signed: "Signed",
  witnessed: "Witnessed",
  cgc_signature_series: "CGC Signature Series",
};

const slabLabels = {
  raw: "Raw (Unslabbed)",
  cgc: "CGC",
  cbc: "CBCS",
  pgx: "PGX",
  other: "Other",
};

function normalizeIssueNumber(issue) {
  if (!issue) return "";
  return String(issue).replace(/^#/, "").trim();
}

function normalizeEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    issueNumber: entry.issueNumber ?? entry.issue_number ?? "",
    coverUrl: entry.coverUrl ?? entry.cover_url ?? "",
    signatureStatus: entry.signatureStatus ?? entry.signature_status ?? "none",
    slabStatus: entry.slabStatus ?? entry.slab_status ?? "raw",
    isKey: entry.isKey ?? entry.is_key ?? false,
    isOwned: entry.isOwned ?? entry.is_owned ?? true,
    series: entry.series ?? "",
    releaseDate: entry.releaseDate ?? entry.release_date ?? "",
    synopsis: entry.synopsis ?? "",
    issueTitle: entry.issueTitle ?? entry.issue_title ?? "",
    variantDescription: entry.variantDescription ?? entry.variant_description ?? "",
    format: entry.format ?? "",
    addedDate: entry.addedDate ?? entry.added_date ?? "",
    coverPrice: entry.coverPrice ?? entry.cover_price ?? "",
    coverCurrency: entry.coverCurrency ?? entry.cover_currency ?? "",
    pageCount: entry.pageCount ?? entry.page_count ?? "",
    age: entry.age ?? "",
    language: entry.language ?? "",
    country: entry.country ?? "",
    keyReason: entry.keyReason ?? entry.key_reason ?? "",
    seriesGroup: entry.seriesGroup ?? entry.series_group ?? "",
    collectionName: entry.collectionName ?? entry.collection_name ?? "",
    collectionHash: entry.collectionHash ?? entry.collection_hash ?? "",
    quantity: entry.quantity ?? "",
    coverDate: entry.coverDate ?? entry.cover_date ?? "",
    publicationDate: entry.publicationDate ?? entry.publication_date ?? "",
  };
}

function getMetaPath(obj, path) {
  if (!obj || !path) return "";
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? "";
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Date(value * 1000).toLocaleDateString();
  } catch (error) {
    return "";
  }
}

function getDisplayTitle(item) {
  if (!item) return "";
  const series = String(item.series || "").trim();
  const title = String(item.title || "").trim();
  return series || title;
}

function autoMatchComic({ queryTitle, queryIssue, candidates }) {
  if (!candidates || candidates.length === 0) return null;
  const normalizedTitle = (queryTitle || "").toLowerCase().trim();
  const normalizedIssue = normalizeIssueNumber(queryIssue);

  let best = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const title = (candidate.title || "").toLowerCase().trim();
    const issue = normalizeIssueNumber(candidate.issueNumber || candidate.issue || "");
    let score = 0;

    if (normalizedTitle && title.includes(normalizedTitle)) score += 3;
    if (normalizedTitle && normalizedTitle.includes(title)) score += 2;
    if (normalizedIssue && issue === normalizedIssue) score += 4;
    if (candidate.publisher) score += 1;
    if (candidate.coverUrl) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function exportToCSV(records) {
  const headers = [
    "title",
    "issueNumber",
    "publisher",
    "grade",
    "signatureStatus",
    "slabStatus",
    "isKey",
    "coverUrl",
    "barcode",
    "notes",
  ];
  const rows = records.map((record) =>
    headers
      .map((header) => {
        const value = record[header] ?? "";
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeTab, setActiveTab] = useState("collection");
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [enrichStatus, setEnrichStatus] = useState("");
  const [isEnriching, setIsEnriching] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [collection, setCollection] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [apiStatus, setApiStatus] = useState("ready");
  const [isSaving, setIsSaving] = useState(false);
  const [scannerMode, setScannerMode] = useState("html5");
  const [editId, setEditId] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("noir_token") || "");
  const [apiBase, setApiBase] = useState(() => localStorage.getItem("noir_api_base") || DEFAULT_API_BASE);
  const [apiHealth, setApiHealth] = useState("unknown");
  const [apiServices, setApiServices] = useState({
    comicvine: false,
    openlibrary: false,
    googlebooks: false,
    metron: false,
    db: false,
  });
  const [apiTestStatus, setApiTestStatus] = useState("");
  const [selectedComic, setSelectedComic] = useState(null);
  const [importReplace, setImportReplace] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(60);
  const [sortBy, setSortBy] = useState("title");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const scannerRef = useRef(null);
  const zxingRef = useRef(null);
  const videoRef = useRef(null);
  const importInputRef = useRef(null);
  const scannerContainerId = "scanner-root";

  const selectedMeta = useMemo(() => {
    if (!selectedComic || !selectedComic.metadata || typeof selectedComic.metadata !== "object") {
      return {};
    }
    return selectedComic.metadata;
  }, [selectedComic]);

  const selectedMetaKeys = useMemo(() => {
    const keys = {};
    if (!selectedMeta || typeof selectedMeta !== "object") return keys;
    for (const key of Object.keys(selectedMeta)) {
      keys[key.toLowerCase().trim()] = selectedMeta[key];
    }
    return keys;
  }, [selectedMeta]);

  useEffect(() => {
    if (!isScanning) return;

    let cancelled = false;
    const html5Qrcode = new Html5Qrcode(scannerContainerId);
    scannerRef.current = html5Qrcode;
    zxingRef.current = new BrowserMultiFormatReader();

    async function startScanner() {
      try {
        setScanStatus("Starting camera...");
        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.777,
          },
          async (decodedText) => {
            if (cancelled) return;
            setScannerMode("html5");
            setScanStatus(`Scanned barcode: ${decodedText}`);
            setForm((prev) => ({ ...prev, barcode: decodedText }));
            await lookupByBarcode(decodedText);
            await html5Qrcode.stop();
            setIsScanning(false);
          },
          () => {}
        );
      } catch (error) {
        setScanStatus("Html5Qrcode failed. Trying ZXing fallback...");
        setScannerMode("zxing");
        try {
          await zxingRef.current.decodeFromVideoDevice(
            undefined,
            videoRef.current,
            async (result) => {
              if (!result || cancelled) return;
              const decodedText = result.getText();
              setScanStatus(`Scanned barcode: ${decodedText}`);
              setForm((prev) => ({ ...prev, barcode: decodedText }));
              await lookupByBarcode(decodedText);
              zxingRef.current.reset();
              setIsScanning(false);
            }
          );
        } catch (fallbackError) {
          setScanStatus("Unable to access camera.");
        }
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        const scanner = scannerRef.current;
        Promise.resolve()
          .then(() => scanner.stop())
          .catch(() => {})
          .finally(() => {
            Promise.resolve()
              .then(() => scanner.clear())
              .catch(() => {});
          });
      }
      if (zxingRef.current) {
        zxingRef.current.reset();
      }
    };
  }, [isScanning]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get("api");
    if (apiParam) {
      saveApiBase(apiParam);
    }
  }, []);

  useEffect(() => {
    async function loadComics() {
      try {
        setApiStatus("loading");
        const [ownedPayload, wishPayload] = await Promise.all([
          fetchJson(`${apiBase}/api/comics?owned=true`, { headers: {} }),
          fetchJson(`${apiBase}/api/comics?owned=false`, { headers: {} }),
        ]);
        setCollection((ownedPayload.results || []).map(normalizeEntry));
        setWishlist((wishPayload.results || []).map(normalizeEntry));
        setApiStatus("ready");
      } catch (error) {
        setApiStatus("offline");
      }
    }

    loadComics();
  }, [authToken, apiBase]);

  useEffect(() => {
    checkApiHealth();
    const timer = setInterval(checkApiHealth, 15000);
    return () => clearInterval(timer);
  }, [apiBase]);

  const filteredCollection = useMemo(() => {
    if (!searchTerm) return collection;
    const term = searchTerm.toLowerCase();
    return collection.filter(
      (item) =>
        getDisplayTitle(item).toLowerCase().includes(term) ||
        String(item.title || "").toLowerCase().includes(term) ||
        String(item.series || "").toLowerCase().includes(term) ||
        item.publisher.toLowerCase().includes(term) ||
        String(item.issueNumber).includes(term)
    );
  }, [collection, searchTerm]);

  const filteredWishlist = useMemo(() => {
    if (!searchTerm) return wishlist;
    const term = searchTerm.toLowerCase();
    return wishlist.filter(
      (item) =>
        getDisplayTitle(item).toLowerCase().includes(term) ||
        String(item.title || "").toLowerCase().includes(term) ||
        String(item.series || "").toLowerCase().includes(term) ||
        item.publisher.toLowerCase().includes(term) ||
        String(item.issueNumber).includes(term)
    );
  }, [wishlist, searchTerm]);

  function saveAuthToken(value) {
    setAuthToken(value);
    localStorage.setItem("noir_token", value);
  }

  function saveApiBase(value) {
    setApiBase(value);
    localStorage.setItem("noir_api_base", value);
  }

  async function checkApiHealth() {
    if (!apiBase) {
      setApiHealth("missing");
      setApiServices((prev) => ({ ...prev, db: false }));
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/health`);
      if (!response.ok) {
        setApiHealth("offline");
        setApiServices((prev) => ({ ...prev, db: false }));
        return;
      }
      const payload = await response.json().catch(() => null);
      setApiHealth(payload?.status === "ok" ? "online" : "offline");
      setApiServices({
        comicvine: Boolean(payload?.services?.comicvine),
        openlibrary: Boolean(payload?.services?.openlibrary),
        googlebooks: Boolean(payload?.services?.googlebooks),
        metron: Boolean(payload?.services?.metron),
        db: Boolean(payload?.db),
      });
    } catch (error) {
      setApiHealth("offline");
      setApiServices((prev) => ({ ...prev, db: false }));
    }
  }

  async function runSelfTest() {
    if (!apiBase) {
      setApiTestStatus("API base missing.");
      return;
    }
    setApiTestStatus("Running self-test...");
    try {
      const response = await fetch(`${apiBase}/api/self-test`);
      if (!response.ok) {
        setApiTestStatus("Self-test failed.");
        return;
      }
      const payload = await response.json();
      const r = payload?.results || {};
      const parts = [
        `DB:${r.db ? "ok" : "fail"}`,
        `CV:${r.comicvine === null ? "n/a" : r.comicvine ? "ok" : "fail"}`,
        `Metron:${r.metron === null ? "n/a" : r.metron ? "ok" : "fail"}`,
        `GBooks:${r.googlebooks ? "ok" : "fail"}`,
        `OL:${r.openlibrary ? "ok" : "fail"}`,
      ];
      setApiTestStatus(parts.join("  "));
    } catch (error) {
      setApiTestStatus("Self-test failed.");
    }
  }

  async function fetchJson(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    };
    if (!apiBase) {
      throw new Error("API base URL is not set.");
    }
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let message = `Request failed (${response.status})`;
      try {
        const parsed = JSON.parse(errorText);
        message = parsed.error || message;
      } catch (e) {
        if (errorText) message = `${message}: ${errorText.slice(0, 200)}`;
      }
      throw new Error(message);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
      return response.text();
    }
    return response.json();
  }

  async function lookupByBarcode(barcode) {
    if (!barcode) return;
    try {
      setIsSearching(true);
      const payload = await fetchJson(
        `${apiBase}/api/barcode?barcode=${encodeURIComponent(barcode)}`,
        { headers: {} }
      );
      const matched = autoMatchComic({ queryTitle: form.title, queryIssue: form.issueNumber, candidates: payload.results || [] });
      if (matched) {
        setForm((prev) => ({
          ...prev,
          title: matched.title || prev.title,
          issueNumber: normalizeIssueNumber(matched.issueNumber || matched.issue),
          publisher: matched.publisher || prev.publisher,
          coverUrl: matched.coverUrl || prev.coverUrl,
          synopsis: matched.synopsis || prev.synopsis,
        }));
      }
      setSearchResults(payload.results || []);
    } catch (error) {
      setScanStatus("Barcode lookup failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function lookupByTitle() {
    if (!form.title) return;
    try {
      setIsSearching(true);
      const payload = await fetchJson(
        `${apiBase}/api/search?title=${encodeURIComponent(form.title)}&issue=${encodeURIComponent(form.issueNumber)}`,
        { headers: {} }
      );
      const matched = autoMatchComic({ queryTitle: form.title, queryIssue: form.issueNumber, candidates: payload.results || [] });
      if (matched) {
        setForm((prev) => ({
          ...prev,
          title: matched.title || prev.title,
          issueNumber: normalizeIssueNumber(matched.issueNumber || matched.issue),
          publisher: matched.publisher || prev.publisher,
          coverUrl: matched.coverUrl || prev.coverUrl,
          synopsis: matched.synopsis || prev.synopsis,
        }));
      }
      setSearchResults(payload.results || []);
    } catch (error) {
      setScanStatus("Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function addEntry(destination) {
    if (!form.title || !form.issueNumber) return;
    const entry = {
      ...form,
      issueNumber: normalizeIssueNumber(form.issueNumber),
      isOwned: destination === "collection",
    };

    setIsSaving(true);
    try {
      if (apiBase) {
        const payload = await fetchJson(`${apiBase}/api/comics`, {
          method: "POST",
          body: JSON.stringify(entry),
        });
        if (payload.result) {
          const normalized = normalizeEntry(payload.result);
          if (destination === "collection") {
            setCollection((prev) => [normalized, ...prev]);
          } else {
            setWishlist((prev) => [normalized, ...prev]);
          }
        }
      } else {
        if (destination === "collection") {
          setCollection((prev) => [entry, ...prev]);
        } else {
          setWishlist((prev) => [entry, ...prev]);
        }
      }
      setForm(defaultForm);
      setSearchResults([]);
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(item) {
    setEditId(item.id);
    setForm({
      title: item.title || "",
      issueNumber: item.issue_number || item.issueNumber || "",
      publisher: item.publisher || "",
      grade: item.grade || "",
      signatureStatus: item.signature_status || item.signatureStatus || "none",
      slabStatus: item.slab_status || item.slabStatus || "raw",
      isKey: item.is_key ?? item.isKey ?? false,
      coverUrl: item.cover_url || item.coverUrl || "",
      barcode: item.barcode || "",
      notes: item.notes || "",
    });
  }

  async function saveEdit(destination) {
    if (!editId) return;
    const payload = {
      ...form,
      issueNumber: normalizeIssueNumber(form.issueNumber),
      isOwned: destination === "collection",
    };
    setIsSaving(true);
    try {
      const response = await fetchJson(`${apiBase}/api/comics/${editId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (response.result) {
        const updated = normalizeEntry(response.result);
        if (destination === "collection") {
          setCollection((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        } else {
          setWishlist((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        }
      }
      setEditId(null);
      setForm(defaultForm);
      setSearchResults([]);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEntry(item) {
    if (!item.id) return;
    
    // Confirmation dialog
    const confirmMsg = `Delete "${getDisplayTitle(item)} #${item.issueNumber}"?\n\nThis cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    
    try {
      await fetchJson(`${apiBase}/api/comics/${item.id}`, { method: "DELETE" });
      if (item.is_owned ?? item.isOwned) {
        setCollection((prev) => prev.filter((entry) => entry.id !== item.id));
      } else {
        setWishlist((prev) => prev.filter((entry) => entry.id !== item.id));
      }
      // Remove from selection if it was selected
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (error) {
      setScanStatus("Delete failed.");
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    
    const confirmMsg = `Delete ${selectedIds.size} comics?\n\nThis cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    
    try {
      setScanStatus(`Deleting ${selectedIds.size} comics...`);
      
      // Delete all selected comics
      const deletePromises = Array.from(selectedIds).map(id =>
        fetchJson(`${apiBase}/api/comics/${id}`, { method: "DELETE" })
      );
      
      await Promise.all(deletePromises);
      
      // Remove from both collection and wishlist
      setCollection(prev => prev.filter(item => !selectedIds.has(item.id)));
      setWishlist(prev => prev.filter(item => !selectedIds.has(item.id)));
      
      setScanStatus(`✅ Deleted ${selectedIds.size} comics`);
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      
      setTimeout(() => setScanStatus(""), 3000);
    } catch (error) {
      setScanStatus(`❌ Bulk delete failed: ${error.message}`);
    }
  }

  function toggleSelection(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    const currentList = activeTab === "collection" ? filteredCollection : filteredWishlist;
    setSelectedIds(new Set(currentList.map(item => item.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function scrollToApiSettings() {
    const el = document.getElementById("api-settings");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const selectedVariant =
    (selectedComic &&
      (selectedComic.variantDescription ||
        getMetaPath(selectedMeta, "edition.displayname") ||
        selectedMetaKeys["variant description"] ||
        selectedMetaKeys["variant"] ||
        "")) ||
    "";
  const selectedFormat =
    (selectedComic &&
      (selectedComic.format ||
        getMetaPath(selectedMeta, "format.displayname") ||
        selectedMetaKeys["format"] ||
        selectedMetaKeys["binding"] ||
        "")) ||
    "";
  const selectedAddedDate =
    (selectedComic &&
      (selectedComic.addedDate ||
        formatTimestamp(getMetaPath(selectedMeta, "addeddate.timestamp")) ||
        selectedMetaKeys["added date"] ||
        selectedMetaKeys["date added"] ||
        "")) ||
    "";
  const selectedIssueTitle =
    (selectedComic &&
      (selectedComic.issueTitle ||
        getMetaPath(selectedMeta, "mainsection.title") ||
        selectedMetaKeys["issue title"] ||
        selectedMetaKeys["story title"] ||
        "")) ||
    "";
  const selectedKeyReason =
    (selectedComic &&
      (selectedComic.keyReason ||
        getMetaPath(selectedMeta, "keycomicreason") ||
        selectedMetaKeys["key reason"] ||
        selectedMetaKeys["keycomicreason"] ||
        "")) ||
    "";
  const selectedAge =
    (selectedComic &&
      (selectedComic.age ||
        getMetaPath(selectedMeta, "age.displayname") ||
        selectedMetaKeys["age"] ||
        "")) ||
    "";
  const selectedLanguage =
    (selectedComic &&
      (selectedComic.language ||
        getMetaPath(selectedMeta, "language.displayname") ||
        selectedMetaKeys["language"] ||
        "")) ||
    "";
  const selectedCountry =
    (selectedComic &&
      (selectedComic.country ||
        getMetaPath(selectedMeta, "country.displayname") ||
        selectedMetaKeys["country"] ||
        "")) ||
    "";

  function mapImportedRow(row) {
    const keys = Object.keys(row || {}).reduce((acc, key) => {
      acc[key.toLowerCase().trim()] = row[key];
      return acc;
    }, {});

    const series = keys["series"] || keys["series title"] || "";
    const title = series || keys["title"] || "";
    const issueTitle = keys["issue title"] || keys["story title"] || keys["title"] || "";
    const issueNumber =
      keys["issue #"] ||
      keys["issue # "] ||
      keys["issue number"] ||
      keys["issue"] ||
      keys["number"] ||
      "";
    const publisher = keys["publisher"] || keys["imprint"] || "";
    const grade = keys["grade"] || keys["cgc grade"] || "";
    const signatureStatus = keys["signature status"] || keys["signature"] || keys["signed"] || "none";
    const slabStatus = keys["slab status"] || keys["slab"] || keys["grading company"] || "raw";
    const isKeyRaw = keys["key"] || keys["key issue"] || keys["key flag"] || "";
    const isKey =
      String(isKeyRaw).toLowerCase().includes("y") || String(isKeyRaw).toLowerCase().includes("true");
    const barcode = keys["barcode"] || keys["isbn"] || keys["upc"] || "";
    const releaseDate = keys["release date"] || keys["released"] || "";
    const variant = keys["variant description"] || keys["variant"] || "";
    const format = keys["format"] || keys["binding"] || "";
    const addedDate = keys["added date"] || keys["date added"] || "";
    const coverUrl = keys["cover url"] || keys["cover"] || keys["coverfrontdefault"] || "";
    const synopsis = keys["synopsis"] || keys["plot"] || keys["description"] || "";
    const coverPrice = keys["cover price"] || keys["price"] || "";
    const pageCount = keys["page count"] || keys["pages"] || "";
    const age = keys["age"] || "";
    const language = keys["language"] || "";
    const country = keys["country"] || "";
    const keyReason = keys["key reason"] || keys["keycomicreason"] || "";
    const seriesGroup = keys["series group"] || "";
    const collectionName = keys["collection name"] || "";
    const collectionHash = keys["collection hash"] || "";
    const quantity = keys["quantity"] || "";
    const coverDate = keys["cover date"] || "";
    const publicationDate = keys["publication date"] || "";
    const notesBase = keys["notes"] || keys["note"] || "";
    const notesParts = [notesBase];
    if (variant) notesParts.push(`Variant: ${variant}`);
    if (format) notesParts.push(`Format: ${format}`);
    if (addedDate) notesParts.push(`Added: ${addedDate}`);
    if (issueTitle && issueTitle !== series) notesParts.push(`Story: ${issueTitle}`);
    const notes = notesParts.filter(Boolean).join(" | ");

    return normalizeEntry({
      title,
      series,
      issueNumber,
      publisher,
      grade,
      signatureStatus,
      slabStatus,
      isKey,
      barcode,
      notes,
      releaseDate,
      coverUrl,
      synopsis,
      issueTitle,
      variantDescription: variant,
      format,
      addedDate,
      coverPrice,
      pageCount,
      age,
      language,
      country,
      keyReason,
      seriesGroup,
      collectionName,
      collectionHash,
      quantity,
      coverDate,
      publicationDate,
      metadata: row,
    });
  }

  function detectDelimiter(sampleLine) {
    if (!sampleLine) return ",";
    const hasComma = sampleLine.includes(",");
    const hasTab = sampleLine.includes("\t");
    const hasSemicolon = sampleLine.includes(";");
    const hasPipe = sampleLine.includes("|");
    if (hasTab && !hasComma) return "\t";
    if (hasSemicolon && !hasComma) return ";";
    if (hasPipe && !hasComma) return "|";
    return ",";
  }

  function parseCsv(content) {
    const lines = String(content || "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const firstLine = lines[0].replace(/^sep=./i, "");
    const delimiter = detectDelimiter(firstLine);
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
      delimiter,
      delimitersToGuess: [",", "\t", ";", "|"],
    });
    if (parsed.errors?.length) {
      throw new Error(parsed.errors[0].message);
    }
    return parsed.data.map(mapImportedRow).filter((row) => row.title);
  }

  function handleImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setImportStatus("Importing...");
        const text = reader.result;
        const replace = importReplace;
        let importResult = null;
        if (file.name.endsWith(".xml")) {
          importResult = await fetchJson(`${apiBase}/api/import-xml`, {
            method: "POST",
            body: JSON.stringify({ xml: text, replace }),
          });
        } else {
          const lowerName = file.name.toLowerCase();
          const isDelimited = lowerName.endsWith(".csv") || lowerName.endsWith(".txt");
          const entries = isDelimited ? parseCsv(text) : JSON.parse(text);
          importResult = await fetchJson(`${apiBase}/api/import`, {
            method: "POST",
            body: JSON.stringify({
              replace,
              entries: entries.map((entry) => ({
                ...entry,
                isOwned: entry.isOwned ?? true,
              })),
            }),
          });
        }
        const [ownedPayload, wishPayload] = await Promise.all([
          fetchJson(`${apiBase}/api/comics?owned=true`, { headers: {} }),
          fetchJson(`${apiBase}/api/comics?owned=false`, { headers: {} }),
        ]);
        setCollection((ownedPayload.results || []).map(normalizeEntry));
        setWishlist((wishPayload.results || []).map(normalizeEntry));
        if (importResult?.total !== undefined) {
          setImportStatus(
            `Import complete. ${importResult.inserted || 0} saved of ${importResult.total} (${replace ? "replaced" : "merged"}).`
          );
        } else {
          setImportStatus("Import complete.");
        }
        
        // Automatically start enrichment after import
        setTimeout(() => handleBulkEnrich(50), 1000);
      } catch (error) {
        setImportStatus(`Import failed: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  async function handleBulkEnrich(limit = 50) {
    if (isEnriching) return;
    
    try {
      setIsEnriching(true);
      setEnrichStatus(`Fetching covers and synopsis (0/${limit})...`);
      
      const result = await fetchJson(`${apiBase}/api/bulk-enrich`, {
        method: "POST",
        body: JSON.stringify({ limit }),
      });
      
      setEnrichStatus(
        `✅ Updated ${result.updated} comics! (${result.errors} not found, ${result.skipped} skipped)`
      );
      
      // Refresh collection to show new covers
      const [ownedPayload, wishPayload] = await Promise.all([
        fetchJson(`${apiBase}/api/comics?owned=true`, { headers: {} }),
        fetchJson(`${apiBase}/api/comics?owned=false`, { headers: {} }),
      ]);
      setCollection((ownedPayload.results || []).map(normalizeEntry));
      setWishlist((wishPayload.results || []).map(normalizeEntry));
      
      // If there are more to process, show option to continue
      if (result.total === limit && result.updated > 0) {
        setTimeout(() => {
          setEnrichStatus(
            `✅ Batch complete! Click "Fetch More Covers" to continue (${result.updated} updated)`
          );
        }, 2000);
      }
    } catch (error) {
      setEnrichStatus("❌ Enrichment failed. Check API connection.");
    } finally {
      setIsEnriching(false);
    }
  }

  async function handleExport(type) {
    const data = activeTab === "collection" ? collection : wishlist;
    if (type === "xml") {
      try {
        const xml = await fetchJson(`${apiBase}/api/export?format=xml`, { headers: {} });
        downloadFile(`${activeTab}-export.xml`, xml, "application/xml");
      } catch (error) {
        setScanStatus("XML export failed.");
      }
      return;
    }
    if (type === "clz-xml") {
      try {
        const response = await fetch(`${apiBase}/api/export?format=clz-xml`);
        const xml = await response.text();
        downloadFile(`${activeTab}-clz-export.xml`, xml, "application/xml");
      } catch (error) {
        setScanStatus("CLZ XML export failed.");
      }
      return;
    }
    if (type === "clz-csv") {
      try {
        const response = await fetch(`${apiBase}/api/export?format=clz-csv`);
        const csv = await response.text();
        downloadFile(`${activeTab}-clz-export.csv`, csv, "text/csv");
      } catch (error) {
        setScanStatus("CLZ CSV export failed.");
      }
      return;
    }
    if (type === "json") {
      downloadFile(`${activeTab}-export.json`, JSON.stringify(data, null, 2), "application/json");
      return;
    }
    const csv = exportToCSV(data);
    downloadFile(`${activeTab}-export.csv`, csv, "text/csv");
  }

  function openModal(item) {
    setSelectedComic(item);
  }

  function closeModal() {
    setSelectedComic(null);
  }

  function sortedList(list) {
    const sorted = [...list];
    if (sortBy === "issue") {
      sorted.sort((a, b) => String(a.issueNumber).localeCompare(String(b.issueNumber), undefined, { numeric: true }));
    } else if (sortBy === "publisher") {
      sorted.sort((a, b) => String(a.publisher || "").localeCompare(String(b.publisher || "")));
    } else if (sortBy === "date") {
      sorted.sort((a, b) => String(a.releaseDate || "").localeCompare(String(b.releaseDate || "")));
    } else {
      sorted.sort((a, b) => String(getDisplayTitle(a)).localeCompare(String(getDisplayTitle(b))));
    }
    return sorted;
  }

  const displayedCollection = useMemo(
    () => sortedList(filteredCollection).slice(0, displayLimit),
    [filteredCollection, displayLimit, sortBy]
  );
  const displayedWishlist = useMemo(
    () => sortedList(filteredWishlist).slice(0, displayLimit),
    [filteredWishlist, displayLimit, sortBy]
  );

  return (
    <div className="min-h-screen bg-noir-900 bg-[radial-gradient(circle_at_top,_#1a1a1a_0%,_#0a0a0a_55%)] text-noir-50 font-display">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="w-full border-b border-noir-800 bg-noir-950 px-6 py-6 md:w-72 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between md:block">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-noir-400">Longbox</p>
              <h1 className="mt-2 text-2xl font-semibold">Noir Collect</h1>
            </div>
            <button
              type="button"
              onClick={() => setIsScanning((prev) => !prev)}
              className="rounded-full border border-noir-700 px-4 py-2 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
            >
              {isScanning ? "Stop Scan" : "Scan"}
            </button>
          </div>
          <div className="mt-8 space-y-3">
            <button
              type="button"
              className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                activeTab === "collection"
                  ? "bg-noir-800 text-noir-50"
                  : "border border-noir-800 text-noir-300 hover:border-noir-600"
              }`}
              onClick={() => setActiveTab("collection")}
            >
              Collection
              <span className="ml-2 text-xs text-noir-400">{collection.length}</span>
            </button>
            <button
              type="button"
              className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                activeTab === "wishlist"
                  ? "bg-noir-800 text-noir-50"
                  : "border border-noir-800 text-noir-300 hover:border-noir-600"
              }`}
              onClick={() => setActiveTab("wishlist")}
            >
              Hunt List
              <span className="ml-2 text-xs text-noir-400">{wishlist.length}</span>
            </button>
          </div>
          <div className="mt-10">
            <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Export</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => handleExport("json")}
                className="flex-1 rounded-lg border border-noir-700 px-3 py-2 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => handleExport("csv")}
                className="flex-1 rounded-lg border border-noir-700 px-3 py-2 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport("xml")}
                className="flex-1 rounded-lg border border-noir-700 px-3 py-2 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
              >
                XML
              </button>
            </div>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => handleExport("clz-csv")}
                className="flex-1 rounded-lg border border-noir-700 px-3 py-2 text-[10px] uppercase tracking-widest text-noir-200 hover:border-noir-500"
              >
                CLZ CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport("clz-xml")}
                className="flex-1 rounded-lg border border-noir-700 px-3 py-2 text-[10px] uppercase tracking-widest text-noir-200 hover:border-noir-500"
              >
                CLZ XML
              </button>
            </div>
          </div>
          <div className="mt-10 text-xs text-noir-500">
            <p>Tip: Red buttons are reserved for core actions.</p>
          </div>
        </aside>

        <main className="flex-1 px-6 py-8 md:px-10">
          {(!apiBase || apiHealth === "offline") && (
            <div className="mb-6 rounded-2xl border border-amber-900/60 bg-amber-950/40 px-6 py-4 text-sm text-amber-200">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-amber-400">API Connection Needed</p>
                  <p className="mt-2 text-sm text-amber-100">
                    {apiBase
                      ? "Your API is unreachable. Set the correct base URL or wake the service."
                      : "Set your API base URL to load your collection and enable imports."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={scrollToApiSettings}
                  className="rounded-full border border-amber-700 px-4 py-2 text-xs uppercase tracking-widest text-amber-200 hover:border-amber-500"
                >
                  Set API URL
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Inventory</p>
                <h2 className="mt-2 text-3xl font-semibold">
                  {activeTab === "collection" ? "Collection" : "Hunt List"}
                </h2>
                <p className="mt-2 text-sm text-noir-400">
                  Keep your longboxes tidy. Scan a barcode or auto-match by title to pull metadata.
                </p>
              </div>
              <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
                <input
                  className="w-full rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100 placeholder:text-noir-600 focus:border-noir-600 focus:outline-none"
                  placeholder="Search by title, issue, or publisher"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <select
                  className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-xs uppercase tracking-widest text-noir-200"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  <option value="title">Sort: Title</option>
                  <option value="issue">Sort: Issue</option>
                  <option value="publisher">Sort: Publisher</option>
                  <option value="date">Sort: Date</option>
                </select>
                <div>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-xs uppercase tracking-widest text-noir-500 hover:border-noir-600"
                  >
                    Import CSV/JSON/XML
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,.json,.xml"
                    onChange={(event) => handleImport(event.target.files?.[0])}
                    className="hidden"
                  />
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-noir-800 bg-noir-900 px-3 py-3 text-xs uppercase tracking-widest text-noir-400">
                  <input
                    type="checkbox"
                    checked={importReplace}
                    onChange={(event) => setImportReplace(event.target.checked)}
                  />
                  Replace
                </label>
                <button
                  type="button"
                  onClick={() => setIsScanning(true)}
                  className="rounded-lg border border-noir-700 px-4 py-3 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
                >
                  Scan
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkEnrich(50)}
                  disabled={isEnriching}
                  className="rounded-lg border border-emerald-700 px-4 py-3 text-xs uppercase tracking-widest text-emerald-200 hover:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isEnriching ? "Fetching..." : "Fetch Covers"}
                </button>
              </div>
            </div>

            {/* Status messages */}
            {(importStatus || enrichStatus) && (
              <div className="rounded-xl border border-noir-800 bg-noir-950 p-4">
                {importStatus && (
                  <p className="text-xs text-noir-400">{importStatus}</p>
                )}
                {enrichStatus && (
                  <p className="mt-1 text-xs text-emerald-400">{enrichStatus}</p>
                )}
              </div>
            )}

            {isScanning && (
              <div className="rounded-2xl border border-noir-800 bg-noir-950 p-4 animate-pulseBorder">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-noir-50">Barcode Scanner</p>
                    <p className="text-xs text-noir-500">
                      Align the barcode within the frame. Works best on mobile.
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-widest text-noir-400">
                    {scanStatus} {scannerMode === "zxing" ? "(ZXing)" : "(html5-qrcode)"}
                  </span>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-noir-800 bg-black">
                  <div id={scannerContainerId} className="min-h-[220px] w-full" />
                  {scannerMode === "zxing" && (
                    <video ref={videoRef} className="h-full w-full" />
                  )}
                </div>
              </div>
            )}

            <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <div className="rounded-2xl border border-noir-800 bg-noir-950 p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-noir-500">
                  {editId ? "Edit Entry" : "Add Entry"}
                </p>
                <div className="mt-5 grid gap-4">
                  <input
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Title"
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                  <input
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Issue #"
                    value={form.issueNumber}
                    onChange={(event) => setForm((prev) => ({ ...prev, issueNumber: event.target.value }))}
                  />
                  <input
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Publisher"
                    value={form.publisher}
                    onChange={(event) => setForm((prev) => ({ ...prev, publisher: event.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                      placeholder="Grade"
                      value={form.grade}
                      onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value }))}
                    />
                    <label className="flex items-center gap-2 rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-300">
                      <input
                        type="checkbox"
                        checked={form.isKey}
                        onChange={(event) => setForm((prev) => ({ ...prev, isKey: event.target.checked }))}
                      />
                      Key Issue
                    </label>
                  </div>
                  <select
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    value={form.signatureStatus}
                    onChange={(event) => setForm((prev) => ({ ...prev, signatureStatus: event.target.value }))}
                  >
                    {Object.entries(signatureLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    value={form.slabStatus}
                    onChange={(event) => setForm((prev) => ({ ...prev, slabStatus: event.target.value }))}
                  >
                    {Object.entries(slabLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Cover URL"
                    value={form.coverUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, coverUrl: event.target.value }))}
                  />
                  <input
                    className="rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Barcode"
                    value={form.barcode}
                    onChange={(event) => setForm((prev) => ({ ...prev, barcode: event.target.value }))}
                  />
                  <textarea
                    className="min-h-[90px] rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Synopsis (auto-filled from ComicVine)"
                    value={form.synopsis}
                    onChange={(event) => setForm((prev) => ({ ...prev, synopsis: event.target.value }))}
                  />
                  <textarea
                    className="min-h-[90px] rounded-lg border border-noir-800 bg-noir-900 px-4 py-3 text-sm text-noir-100"
                    placeholder="Notes"
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => (editId ? saveEdit(activeTab) : addEntry(activeTab))}
                      className="flex-1 rounded-lg bg-noir-cta px-4 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(225,29,72,0.35)] disabled:opacity-70"
                      disabled={isSaving}
                    >
                      {isSaving
                        ? "Saving..."
                        : editId
                        ? "Save Changes"
                        : activeTab === "collection"
                        ? "Add to Collection"
                        : "Add to Hunt"}
                    </button>
                    <button
                      type="button"
                      onClick={lookupByTitle}
                      className="rounded-lg border border-noir-700 px-4 py-3 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
                      disabled={isSearching}
                    >
                      Auto-Match
                    </button>
                  </div>
                  <div id="api-settings" className="rounded-xl border border-noir-800 bg-noir-900 px-4 py-3 text-xs text-noir-400">
                    <p className="text-[10px] uppercase tracking-[0.35em] text-noir-500">API Base URL</p>
                    <input
                      className="mt-2 w-full rounded-lg border border-noir-800 bg-noir-900 px-3 py-2 text-xs text-noir-200"
                      placeholder="http://127.0.0.1:4000"
                      value={apiBase}
                      onChange={(event) => saveApiBase(event.target.value)}
                    />
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          apiHealth === "online"
                            ? "bg-emerald-400"
                            : apiHealth === "offline"
                            ? "bg-red-400"
                            : apiHealth === "missing"
                            ? "bg-amber-400"
                            : "bg-noir-500"
                        }`}
                      />
                      <span className="text-[10px] uppercase tracking-[0.35em] text-noir-500">
                        {apiHealth === "online"
                          ? "API Online"
                          : apiHealth === "offline"
                          ? "API Offline"
                          : apiHealth === "missing"
                          ? "API Missing"
                          : "API Unknown"}
                      </span>
                      <button
                        type="button"
                        onClick={checkApiHealth}
                        className="ml-auto rounded-full border border-noir-700 px-2 py-1 text-[10px] uppercase tracking-widest text-noir-400 hover:border-noir-500"
                      >
                        Check
                      </button>
                      <button
                        type="button"
                        onClick={runSelfTest}
                        className="rounded-full border border-noir-700 px-2 py-1 text-[10px] uppercase tracking-widest text-noir-400 hover:border-noir-500"
                      >
                        Self-Test
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.25em] text-noir-500">
                      <span className={apiServices.db ? "text-emerald-400" : "text-red-400"}>DB</span>
                      <span className={apiServices.comicvine ? "text-emerald-400" : "text-red-400"}>CV</span>
                      <span className={apiServices.metron ? "text-emerald-400" : "text-red-400"}>Metron</span>
                      <span className={apiServices.googlebooks ? "text-emerald-400" : "text-red-400"}>GBooks</span>
                      <span className={apiServices.openlibrary ? "text-emerald-400" : "text-red-400"}>OL</span>
                    </div>
                    {apiTestStatus && (
                      <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-noir-500">
                        {apiTestStatus}
                      </p>
                    )}
                    <p className="mt-3 text-[10px] uppercase tracking-[0.35em] text-noir-500">API Token</p>
                    <input
                      className="mt-2 w-full rounded-lg border border-noir-800 bg-noir-900 px-3 py-2 text-xs text-noir-200"
                      placeholder="Optional auth token"
                      value={authToken}
                      onChange={(event) => saveAuthToken(event.target.value)}
                    />
                    {!apiBase && (
                      <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-noir-500">
                        Add ?api=YOUR_RENDER_URL to the page URL to set once.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-noir-800 bg-noir-950 p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Longbox View</p>
                  <div className="flex items-center gap-3">
                    {isSearching && <span className="text-xs text-noir-400">Searching...</span>}
                    {apiStatus === "offline" && (
                      <span className="text-xs text-noir-500">Offline mode</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        if (isSelectionMode) setSelectedIds(new Set());
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs uppercase tracking-widest transition ${
                        isSelectionMode 
                          ? 'border-emerald-700 bg-emerald-900/20 text-emerald-200' 
                          : 'border-noir-800 text-noir-400 hover:border-noir-600'
                      }`}
                    >
                      {isSelectionMode ? '✓ Select Mode' : 'Select'}
                    </button>
                  </div>
                </div>
                
                {isSelectionMode && (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-noir-800 bg-noir-900 p-3">
                    <span className="text-xs text-noir-400">
                      {selectedIds.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={selectAll}
                      className="rounded-lg border border-noir-800 px-3 py-1.5 text-xs uppercase tracking-widest text-noir-400 hover:border-noir-600"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={deselectAll}
                      className="rounded-lg border border-noir-800 px-3 py-1.5 text-xs uppercase tracking-widest text-noir-400 hover:border-noir-600"
                    >
                      Deselect All
                    </button>
                    <button
                      type="button"
                      onClick={bulkDelete}
                      disabled={selectedIds.size === 0}
                      className="ml-auto rounded-lg border border-red-900 bg-red-950/30 px-4 py-1.5 text-xs uppercase tracking-widest text-red-300 hover:border-red-700 hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Delete ({selectedIds.size})
                    </button>
                  </div>
                )}
                
                <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {(activeTab === "collection" ? displayedCollection : displayedWishlist).map((item, index) => (
                    <div
                      key={`${getDisplayTitle(item)}-${item.issueNumber}-${index}`}
                      className={`group flex flex-col overflow-hidden rounded-2xl border transition animate-floatIn ${
                        selectedIds.has(item.id)
                          ? 'border-emerald-600 bg-emerald-950/20'
                          : 'border-noir-800 bg-noir-900 hover:border-noir-600'
                      }`}
                    >
                      <div className="relative h-48 overflow-hidden bg-black">
                        {isSelectionMode && (
                          <div className="absolute left-3 top-3 z-10">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelection(item.id)}
                              className="h-5 w-5 cursor-pointer rounded border-2 border-noir-600 bg-noir-900 checked:bg-emerald-600"
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => openModal(item)}
                          className="h-full w-full"
                        >
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={`${getDisplayTitle(item)} #${item.issueNumber}`}
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-noir-500">
                              Cover needed
                            </div>
                          )}
                        </button>
                        {item.isKey && (
                          <span className="absolute left-4 top-4 rounded-full bg-noir-cta px-3 py-1 text-[10px] uppercase tracking-widest text-white">
                            Key
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-4">
                        <div>
                          <p className="text-sm font-semibold text-noir-50">
                            {getDisplayTitle(item)} <span className="text-noir-400">#{item.issueNumber}</span>
                          </p>
                          <p className="text-xs text-noir-400">{item.publisher || "Unknown publisher"}</p>
                          {item.synopsis && (
                            <p className="mt-2 text-xs text-noir-500 line-clamp-3">
                              {item.synopsis}
                            </p>
                          )}
                        </div>
                        <div className="mt-auto grid grid-cols-2 gap-2 text-xs text-noir-400">
                          <span>Grade: {item.grade || "N/A"}</span>
                          <span>Signature: {signatureLabels[item.signatureStatus] || "None"}</span>
                          <span>Slab: {slabLabels[item.slabStatus] || "Raw"}</span>
                          <span>Barcode: {item.barcode || "-"}</span>
                        </div>
                        <div className="mt-3 flex gap-2 text-xs uppercase tracking-widest">
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            className="flex-1 rounded-lg border border-emerald-800 bg-emerald-950/20 px-2 py-2 text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/30 transition"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteEntry(item)}
                            className="flex-1 rounded-lg border border-red-900 bg-red-950/20 px-2 py-2 text-red-300 hover:border-red-700 hover:bg-red-900/40 transition"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {(activeTab === "collection" ? filteredCollection : filteredWishlist).length > displayLimit && (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setDisplayLimit((prev) => prev + 60)}
                      className="rounded-lg border border-noir-700 px-4 py-3 text-xs uppercase tracking-widest text-noir-200 hover:border-noir-500"
                    >
                      Load More
                    </button>
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="mt-8">
                    <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Auto-Match Results</p>
                    <div className="mt-4 grid gap-3">
                      {searchResults.slice(0, 5).map((result, idx) => (
                        <button
                          key={`${result.title || result.series || ""}-${idx}`}
                          type="button"
                          className="flex items-center gap-3 rounded-xl border border-noir-800 bg-noir-900 px-4 py-3 text-left text-sm text-noir-200 hover:border-noir-600"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              title: result.title || prev.title,
                              issueNumber: normalizeIssueNumber(result.issueNumber || result.issue),
                              publisher: result.publisher || prev.publisher,
                              coverUrl: result.coverUrl || prev.coverUrl,
                            }))
                          }
                        >
                          <span className="font-semibold">{result.title || result.series || "Untitled"}</span>
                          <span className="text-noir-500">#{normalizeIssueNumber(result.issueNumber || result.issue)}</span>
                          <span className="ml-auto text-xs text-noir-500">{result.publisher}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
          {selectedComic && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
              <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-noir-700 bg-noir-950 shadow-2xl">
                <div className="flex items-center justify-between border-b border-noir-800 px-6 py-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Cover Preview</p>
                    <h3 className="mt-2 text-lg font-semibold text-noir-50">
                      {getDisplayTitle(selectedComic)}{" "}
                      <span className="text-noir-400">#{selectedComic.issueNumber}</span>
                    </h3>
                    <p className="text-xs text-noir-400">{selectedComic.publisher || "Unknown publisher"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-noir-700 px-3 py-1 text-xs uppercase tracking-widest text-noir-300 hover:border-noir-500"
                  >
                    Close
                  </button>
                </div>
                <div className="grid gap-6 p-6 md:grid-cols-[220px_1fr]">
                  <div className="overflow-hidden rounded-xl border border-noir-800 bg-black">
                    {selectedComic.coverUrl ? (
                      <img
                        src={selectedComic.coverUrl}
                        alt={`${getDisplayTitle(selectedComic)} #${selectedComic.issueNumber}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-64 items-center justify-center text-xs text-noir-500">
                        Cover needed
                      </div>
                    )}
                  </div>
                  <div className="space-y-4 text-sm text-noir-300">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-noir-500">Synopsis</p>
                      <p className="mt-2 text-sm text-noir-200">
                        {selectedComic.synopsis || "No synopsis available yet."}
                      </p>
                    </div>
                    {(selectedVariant ||
                      selectedFormat ||
                      selectedAddedDate ||
                      selectedIssueTitle ||
                      selectedKeyReason ||
                      selectedAge ||
                      selectedLanguage ||
                      selectedCountry) && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.35em] text-noir-500">CLZ Details</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-noir-400">
                          {selectedIssueTitle && <span>Story: {selectedIssueTitle}</span>}
                          {selectedVariant && <span>Variant: {selectedVariant}</span>}
                          {selectedFormat && <span>Format: {selectedFormat}</span>}
                          {selectedAddedDate && <span>Added: {selectedAddedDate}</span>}
                          {selectedKeyReason && <span>Key: {selectedKeyReason}</span>}
                          {selectedAge && <span>Age: {selectedAge}</span>}
                          {selectedLanguage && <span>Language: {selectedLanguage}</span>}
                          {selectedCountry && <span>Country: {selectedCountry}</span>}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs text-noir-400">
                      <span>Grade: {selectedComic.grade || "N/A"}</span>
                      <span>Signature: {signatureLabels[selectedComic.signatureStatus] || "None"}</span>
                      <span>Slab: {slabLabels[selectedComic.slabStatus] || "Raw"}</span>
                      <span>Barcode: {selectedComic.barcode || "-"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
