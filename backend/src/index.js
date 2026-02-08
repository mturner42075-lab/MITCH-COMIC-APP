const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Pool } = require("pg");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;
const COMICVINE_API_KEY = process.env.COMICVINE_API_KEY;
const COMICVINE_BASE = "https://comicvine.gamespot.com/api";
const OPEN_LIBRARY_BASE = process.env.OPEN_LIBRARY_API || "https://openlibrary.org";
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const METRON_BASE = process.env.METRON_BASE || "https://metron.cloud/api";
const METRON_USERNAME = process.env.METRON_USERNAME;
const METRON_PASSWORD = process.env.METRON_PASSWORD;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.path === "/api/health") return next();
  if (req.ip === "::1" || req.ip === "127.0.0.1" || req.ip === "::ffff:127.0.0.1") return next();
  const header = req.headers["authorization"] || "";
  const apiKey = req.headers["x-api-key"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === AUTH_TOKEN || apiKey === AUTH_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

function normalizeIssueNumber(issue) {
  if (!issue) return "";
  return String(issue).replace(/^#/, "").trim();
}

function selectBestCandidate(candidates, title, issueNumber) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const normalizedTitle = String(title || "").toLowerCase();
  const normalizedIssue = normalizeIssueNumber(issueNumber);
  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let score = 0;
    const candTitle = String(candidate.title || "").toLowerCase();
    const candIssue = normalizeIssueNumber(candidate.issueNumber || candidate.issue);
    if (normalizedIssue && candIssue === normalizedIssue) score += 3;
    if (normalizedTitle && candTitle.includes(normalizedTitle)) score += 2;
    if (candidate.coverUrl) score += 1;
    if (candidate.synopsis) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function parseReleaseDate(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;
  // Try ISO first.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Try formats like "Apr 1984" or "April 1984".
  const monthMap = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const parts = text.split(" ");
  if (parts.length >= 2) {
    const monthKey = parts[0].slice(0, 3).toLowerCase();
    const year = parts[1].replace(/[^0-9]/g, "");
    if (monthMap[monthKey] && year.length === 4) {
      return `${year}-${monthMap[monthKey]}-01`;
    }
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseNumber(input) {
  if (input === null || input === undefined || input === "") return null;
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function formatClzDisplayDate(value) {
  if (!value) return "";
  const dateObj = new Date(value);
  if (Number.isNaN(dateObj.getTime())) return "";
  const year = dateObj.getFullYear();
  const month = dateObj.toLocaleString("en-US", { month: "short" });
  const day = dateObj.getDate();
  if (day === 1) {
    return `${month} ${year}`;
  }
  const dayText = String(day).padStart(2, "0");
  return `${month} ${dayText}, ${year}`;
}

function formatClzDateStruct(value) {
  if (!value) return null;
  const dateObj = new Date(value);
  if (Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  const hasDay = dateObj.getDate() !== 1;
  return {
    year: { displayname: String(year) },
    month,
    day: hasDay ? day : undefined,
    date: hasDay ? `${year}/${month}/${day}` : `${year}/${month}`,
    displaydate: formatClzDisplayDate(value),
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function splitIssueNumber(issueNumber) {
  if (!issueNumber) return { issuenr: "", issueext: "" };
  const text = String(issueNumber).trim();
  const match = text.match(/^(\d+)(.*)$/);
  if (!match) return { issuenr: text, issueext: "" };
  return { issuenr: match[1], issueext: match[2] || "" };
}

function getXmlValue(obj, path, fallback = "") {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? fallback;
}

function parseClzComic(node) {
  const storyTitle = getXmlValue(node, "mainsection.title", "");
  const series = getXmlValue(node, "mainsection.series.displayname", "") || "";
  // Prefer series name for title to avoid story/splash-page titles.
  const title = series || storyTitle;
  const synopsis = getXmlValue(node, "mainsection.plot", "") || null;
  const pageCountRaw = getXmlValue(node, "mainsection.pagecount", "") || "";
  const pageCount = pageCountRaw ? Number(pageCountRaw) : null;
  const issuenr = getXmlValue(node, "issuenr", "");
  const issueext = getXmlValue(node, "issueext", "");
  const issueNumber = `${issuenr}${issueext}`.trim();
  const publisher = getXmlValue(node, "publisher.displayname", "") || null;
  const seriesGroup = getXmlValue(node, "seriesgroup.displayname", "") || null;
  const releaseDate =
    getXmlValue(node, "releasedate.displaydate", "") || getXmlValue(node, "coverdate.displaydate", "") || null;
  const coverDate =
    getXmlValue(node, "coverdate.displaydate", "") || getXmlValue(node, "publicationdate.displaydate", "") || null;
  const publicationDate =
    getXmlValue(node, "publicationdate.displaydate", "") || getXmlValue(node, "coverdate.displaydate", "") || null;
  const coverUrl = getXmlValue(node, "coverfrontdefault", "") || null;
  const barcode = getXmlValue(node, "barcode", "") || null;
  const variant = getXmlValue(node, "edition.displayname", "");
  const format = getXmlValue(node, "format.displayname", "");
  const addedTimestamp = getXmlValue(node, "addeddate.timestamp", "");
  const quantityRaw = getXmlValue(node, "quantity", "");
  const quantity = quantityRaw ? Number(quantityRaw) : null;
  const coverPriceRaw = getXmlValue(node, "coverprice", "");
  const coverPrice = coverPriceRaw ? Number(coverPriceRaw) : null;
  const age = getXmlValue(node, "age.displayname", "") || null;
  const language = getXmlValue(node, "language.displayname", "") || null;
  const country = getXmlValue(node, "country.displayname", "") || null;
  const collectionName = getXmlValue(node, "collection.displayname", "") || null;
  const collectionHash = getXmlValue(node, "collection.hash", "") || null;
  const collectionStatus = getXmlValue(node, "collectionstatus", "");
  const keyReason = getXmlValue(node, "keycomicreason", "");
  const isKeyRaw = getXmlValue(node, "iskeycomic", "");
  const isKeyText = String(isKeyRaw || "");
  const isKey = isKeyText && isKeyText.toLowerCase() !== "no";
  const grade = getXmlValue(node, "grade.rating", "") || null;
  const slab = getXmlValue(node, "isslabbed", "");
  const slabText = String(slab || "");
  const slabStatus = slabText && slabText.toLowerCase() !== "raw" && slabText !== "0" ? "cgc" : "raw";
  const notesParts = [];
  if (variant) notesParts.push(`Variant: ${variant}`);
  if (format) notesParts.push(`Format: ${format}`);
  if (addedTimestamp) {
    const addedDate = new Date(Number(addedTimestamp) * 1000);
    if (!Number.isNaN(addedDate.getTime())) {
      notesParts.push(`Added: ${addedDate.toLocaleDateString("en-US")}`);
    }
  }
  if (keyReason) notesParts.push(keyReason);
  if (storyTitle && storyTitle !== series) notesParts.push(`Story: ${storyTitle}`);
  const notes = notesParts.join(" | ") || null;
  const collectionStatusText = String(collectionStatus || "").toLowerCase();
  const isOwned =
    collectionStatusText.includes("collection") || collectionStatusText === "" || collectionStatusText === "in collection";

  return {
    title: title || series,
    series: series || null,
    issueTitle: storyTitle || null,
    issueNumber,
    publisher,
    releaseDate,
    coverDate,
    publicationDate,
    coverUrl,
    barcode,
    variantDescription: variant || null,
    format: format || null,
    addedDate: addedTimestamp ? new Date(Number(addedTimestamp) * 1000) : null,
    coverPrice,
    pageCount,
    age,
    language,
    country,
    keyReason: keyReason || null,
    seriesGroup,
    collectionName,
    collectionHash,
    quantity,
    isKey,
    grade,
    slabStatus,
    signatureStatus: "none",
    notes,
    synopsis,
    isOwned,
    metadata: node,
  };
}

async function updateTitlesFromSeries(client) {
  await client.query(
    `UPDATE comics c
     SET title = c.series
     WHERE c.series IS NOT NULL
       AND c.series <> ''
       AND (c.title IS NULL OR c.title <> c.series)
       AND NOT EXISTS (
         SELECT 1 FROM comics c2
         WHERE c2.title = c.series
           AND c2.issue_number = c.issue_number
           AND c2.is_owned = c.is_owned
           AND (c2.publisher IS NOT DISTINCT FROM c.publisher)
           AND c2.id <> c.id
       )`
  );
}

function buildInsertQuery(rows) {
  const columns = [
    "title",
    "issue_number",
    "publisher",
    "grade",
    "signature_status",
    "slab_status",
    "is_key",
    "is_owned",
    "cover_url",
    "barcode",
    "notes",
    "series",
    "volume",
    "release_date",
    "synopsis",
    "issue_title",
    "variant_description",
    "format",
    "added_date",
    "cover_price",
    "cover_currency",
    "page_count",
    "age",
    "language",
    "country",
    "key_reason",
    "series_group",
    "collection_name",
    "collection_hash",
    "quantity",
    "cover_date",
    "publication_date",
    "metron_issue_id",
    "metron_series_id",
    "metadata",
  ];

  const values = [];
  const placeholders = rows
    .map((row, rowIndex) => {
      const start = rowIndex * columns.length;
      const rowPlaceholders = columns.map((_, colIndex) => `$${start + colIndex + 1}`);
      values.push(
        row.title,
        row.issueNumber,
        row.publisher,
        row.grade,
        row.signatureStatus,
        row.slabStatus,
        row.isKey,
        row.isOwned,
        row.coverUrl,
        row.barcode,
        row.notes,
        row.series,
        row.volume,
        row.releaseDate,
        row.synopsis || null,
        row.issueTitle || null,
        row.variantDescription || null,
        row.format || null,
        row.addedDate || null,
        row.coverPrice || null,
        row.coverCurrency || null,
        row.pageCount || null,
        row.age || null,
        row.language || null,
        row.country || null,
        row.keyReason || null,
        row.seriesGroup || null,
        row.collectionName || null,
        row.collectionHash || null,
        row.quantity || null,
        row.coverDate || null,
        row.publicationDate || null,
        row.metronIssueId || null,
        row.metronSeriesId || null,
        row.metadata
      );
      return `(${rowPlaceholders.join(",")})`;
    })
    .join(",");

  const sql = `INSERT INTO comics (${columns.join(",")})
    VALUES ${placeholders}
    ON CONFLICT (title, issue_number, publisher, is_owned)
    DO UPDATE SET
      grade = EXCLUDED.grade,
      signature_status = EXCLUDED.signature_status,
      slab_status = EXCLUDED.slab_status,
      is_key = EXCLUDED.is_key,
      cover_url = EXCLUDED.cover_url,
      barcode = EXCLUDED.barcode,
      notes = EXCLUDED.notes,
      series = EXCLUDED.series,
      volume = EXCLUDED.volume,
      release_date = EXCLUDED.release_date,
      synopsis = EXCLUDED.synopsis,
      issue_title = EXCLUDED.issue_title,
      variant_description = EXCLUDED.variant_description,
      format = EXCLUDED.format,
      added_date = EXCLUDED.added_date,
      cover_price = EXCLUDED.cover_price,
      cover_currency = EXCLUDED.cover_currency,
      page_count = EXCLUDED.page_count,
      age = EXCLUDED.age,
      language = EXCLUDED.language,
      country = EXCLUDED.country,
      key_reason = EXCLUDED.key_reason,
      series_group = EXCLUDED.series_group,
      collection_name = EXCLUDED.collection_name,
      collection_hash = EXCLUDED.collection_hash,
      quantity = EXCLUDED.quantity,
      cover_date = EXCLUDED.cover_date,
      publication_date = EXCLUDED.publication_date,
      metron_issue_id = EXCLUDED.metron_issue_id,
      metron_series_id = EXCLUDED.metron_series_id,
      metadata = EXCLUDED.metadata
    RETURNING *`;

  return { sql, values };
}

function buildUpdateQuery(rows) {
  const columns = [
    "title",
    "issue_number",
    "publisher",
    "is_owned",
    "grade",
    "signature_status",
    "slab_status",
    "is_key",
    "cover_url",
    "barcode",
    "notes",
    "series",
    "volume",
    "release_date",
    "synopsis",
    "issue_title",
    "variant_description",
    "format",
    "added_date",
    "cover_price",
    "cover_currency",
    "page_count",
    "age",
    "language",
    "country",
    "key_reason",
    "series_group",
    "collection_name",
    "collection_hash",
    "quantity",
    "cover_date",
    "publication_date",
    "metron_issue_id",
    "metron_series_id",
    "metadata",
  ];
  const types = [
    "text",
    "text",
    "text",
    "boolean",
    "text",
    "signature_status",
    "slab_status",
    "boolean",
    "text",
    "text",
    "text",
    "text",
    "text",
    "date",
    "text",
    "text",
    "text",
    "text",
    "date",
    "numeric",
    "text",
    "integer",
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
    "integer",
    "date",
    "date",
    "integer",
    "integer",
    "jsonb",
  ];

  const values = [];
  const placeholders = rows
    .map((row, rowIndex) => {
      const start = rowIndex * columns.length;
      const rowPlaceholders = columns.map(
        (_, colIndex) => `$${start + colIndex + 1}::${types[colIndex]}`
      );
      values.push(
        row.title,
        row.issueNumber,
        row.publisher,
        row.isOwned,
        row.grade,
        row.signatureStatus,
        row.slabStatus,
        row.isKey,
        row.coverUrl,
        row.barcode,
        row.notes,
        row.series,
        row.volume,
        row.releaseDate,
        row.synopsis || null,
        row.issueTitle || null,
        row.variantDescription || null,
        row.format || null,
        row.addedDate || null,
        row.coverPrice || null,
        row.coverCurrency || null,
        row.pageCount || null,
        row.age || null,
        row.language || null,
        row.country || null,
        row.keyReason || null,
        row.seriesGroup || null,
        row.collectionName || null,
        row.collectionHash || null,
        row.quantity || null,
        row.coverDate || null,
        row.publicationDate || null,
        row.metronIssueId || null,
        row.metronSeriesId || null,
        row.metadata
      );
      return `(${rowPlaceholders.join(",")})`;
    })
    .join(",");

  const sql = `WITH data (${columns.join(",")}) AS (VALUES ${placeholders})
    UPDATE comics c
    SET
      grade = COALESCE(data.grade, c.grade),
      signature_status = COALESCE(data.signature_status, c.signature_status),
      slab_status = COALESCE(data.slab_status, c.slab_status),
      is_key = COALESCE(data.is_key, c.is_key),
      cover_url = COALESCE(data.cover_url, c.cover_url),
      barcode = COALESCE(data.barcode, c.barcode),
      notes = COALESCE(data.notes, c.notes),
      series = COALESCE(data.series, c.series),
      volume = COALESCE(data.volume, c.volume),
      release_date = COALESCE(data.release_date, c.release_date),
      synopsis = COALESCE(data.synopsis, c.synopsis),
      issue_title = COALESCE(data.issue_title, c.issue_title),
      variant_description = COALESCE(data.variant_description, c.variant_description),
      format = COALESCE(data.format, c.format),
      added_date = COALESCE(data.added_date, c.added_date),
      cover_price = COALESCE(data.cover_price, c.cover_price),
      cover_currency = COALESCE(data.cover_currency, c.cover_currency),
      page_count = COALESCE(data.page_count, c.page_count),
      age = COALESCE(data.age, c.age),
      language = COALESCE(data.language, c.language),
      country = COALESCE(data.country, c.country),
      key_reason = COALESCE(data.key_reason, c.key_reason),
      series_group = COALESCE(data.series_group, c.series_group),
      collection_name = COALESCE(data.collection_name, c.collection_name),
      collection_hash = COALESCE(data.collection_hash, c.collection_hash),
      quantity = COALESCE(data.quantity, c.quantity),
      cover_date = COALESCE(data.cover_date, c.cover_date),
      publication_date = COALESCE(data.publication_date, c.publication_date),
      metron_issue_id = COALESCE(data.metron_issue_id, c.metron_issue_id),
      metron_series_id = COALESCE(data.metron_series_id, c.metron_series_id),
      metadata = COALESCE(data.metadata, c.metadata)
    FROM data
    WHERE c.title = data.title
      AND c.issue_number = data.issue_number
      AND c.publisher IS NOT DISTINCT FROM data.publisher
      AND c.is_owned = data.is_owned
    RETURNING c.id`;

  return { sql, values };
}

function mapOpenLibraryToComic(doc) {
  return {
    title: doc.title,
    issueNumber: "",
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : "",
    synopsis: doc.first_sentence ? String(doc.first_sentence) : "",
    metadata: doc,
    source: "openlibrary",
  };
}

function mapGoogleBooksToComic(item) {
  const volume = item.volumeInfo || {};
  const image = volume.imageLinks || {};
  return {
    title: volume.title || "",
    issueNumber: "",
    publisher: volume.publisher || "",
    coverUrl: image.thumbnail || image.smallThumbnail || "",
    synopsis: volume.description ? String(volume.description).replace(/<[^>]*>/g, "").trim() : "",
    metadata: item,
    source: "googlebooks",
  };
}

function mapMetronIssue(issue) {
  const series = issue.series || {};
  const publisher = series.publisher || {};
  return {
    title: series.name || issue.name || "",
    issueNumber: normalizeIssueNumber(issue.number || issue.issue_number),
    publisher: publisher.name || issue.publisher || "",
    coverUrl: issue.image || "",
    synopsis: issue.desc || "",
    metronIssueId: issue.id || null,
    metronSeriesId: series.id || null,
    metadata: issue,
    source: "metron",
  };
}

function mapComicVineIssue(issue) {
  const volume = issue.volume || {};
  // Clean up HTML from description if present
  const description = issue.description || issue.deck || "";
  const cleanDescription = description.replace(/<[^>]*>/g, "").trim();
  
  return {
    title: volume.name || issue.name || "",
    issueNumber: normalizeIssueNumber(issue.issue_number || issue.issueNumber),
    publisher: volume.publisher?.name || issue.publisher || "",
    coverUrl: issue.image?.super_url || issue.image?.original_url || "",
    synopsis: cleanDescription,
    metadata: issue,
    source: "comicvine",
  };
}

async function fetchComicVine(path, params = {}) {
  if (!COMICVINE_API_KEY) return null;
  const response = await axios.get(`${COMICVINE_BASE}${path}`, {
    params: {
      api_key: COMICVINE_API_KEY,
      format: "json",
      ...params,
    },
    headers: {
      "User-Agent": "Noir-Collect/0.1 (open-source)"
    }
  });
  return response.data;
}

async function fetchMetron(path, params = {}) {
  if (!METRON_USERNAME || !METRON_PASSWORD) return null;
  const response = await axios.get(`${METRON_BASE}${path}`, {
    params,
    auth: {
      username: METRON_USERNAME,
      password: METRON_PASSWORD,
    },
    headers: {
      "User-Agent": "Noir-Collect/0.1 (open-source)",
    },
  });
  return response.data;
}

async function searchComicVineByTitle(title, issueNumber) {
  if (!COMICVINE_API_KEY) return [];

  const volumesResponse = await fetchComicVine("/volumes/", {
    filter: `name:${title}`,
    sort: "name:asc",
    limit: 5,
    field_list: "id,name,publisher",
  });

  const volumes = volumesResponse?.results || [];
  const issueQueries = volumes.slice(0, 3).map((volume) =>
    fetchComicVine("/issues/", {
      filter: `volume:${volume.id}` + (issueNumber ? `,issue_number:${issueNumber}` : ""),
      sort: "cover_date:desc",
      limit: issueNumber ? 5 : 3,
      field_list: "id,name,issue_number,volume,image,cover_date,description,deck",
    })
  );

  const issueResponses = await Promise.all(issueQueries);
  const issues = issueResponses.flatMap((response) => response?.results || []);
  return issues.map(mapComicVineIssue);
}

async function safeSearch(fn, fallback = []) {
  try {
    const result = await fn();
    return Array.isArray(result) ? result : fallback;
  } catch (error) {
    return fallback;
  }
}

async function searchOpenLibraryByTitle(title) {
  const response = await axios.get(`${OPEN_LIBRARY_BASE}/search.json`, {
    params: {
      title,
      limit: 5,
      fields: "title,publisher,cover_i,first_publish_year,isbn",
    },
  });
  return (response.data?.docs || []).map(mapOpenLibraryToComic);
}

async function searchOpenLibraryByIsbn(isbn) {
  const response = await axios.get(`${OPEN_LIBRARY_BASE}/isbn/${isbn}.json`);
  if (!response.data) return [];
  const coverUrl = isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : "";
  return [
    {
      title: response.data.title,
      issueNumber: "",
      publisher: Array.isArray(response.data.publishers) ? response.data.publishers[0] : response.data.publishers,
      coverUrl,
      synopsis: response.data.subtitle || "",
      metadata: response.data,
      source: "openlibrary",
    },
  ];
}

async function searchMetronByTitle(title, issueNumber, publisher) {
  if (!METRON_USERNAME || !METRON_PASSWORD) return [];
  const params = {
    series_name: title,
    page_size: 5,
  };
  if (issueNumber) params.number = issueNumber;
  if (publisher) params.publisher_name = publisher;
  const data = await fetchMetron("/issue/", params);
  return (data?.results || []).map(mapMetronIssue);
}

async function searchMetronByUpc(upc) {
  if (!METRON_USERNAME || !METRON_PASSWORD) return [];
  const data = await fetchMetron("/issue/", { upc, page_size: 5 });
  return (data?.results || []).map(mapMetronIssue);
}

async function searchGoogleBooksByIsbn(isbn) {
  const response = await axios.get("https://www.googleapis.com/books/v1/volumes", {
    params: {
      q: `isbn:${isbn}`,
      key: GOOGLE_BOOKS_API_KEY || undefined,
      maxResults: 5,
    },
  });
  return (response.data?.items || []).map(mapGoogleBooksToComic);
}

async function searchGoogleBooksByTitle(title) {
  const response = await axios.get("https://www.googleapis.com/books/v1/volumes", {
    params: {
      q: `intitle:${title}`,
      key: GOOGLE_BOOKS_API_KEY || undefined,
      maxResults: 5,
    },
  });
  return (response.data?.items || []).map(mapGoogleBooksToComic);
}

app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  try {
    await pool.query("SELECT 1");
    dbOk = true;
  } catch (error) {
    dbOk = false;
  }

  res.json({
    status: dbOk ? "ok" : "degraded",
    db: dbOk,
    services: {
      comicvine: Boolean(COMICVINE_API_KEY),
      openlibrary: Boolean(OPEN_LIBRARY_BASE),
      googlebooks: Boolean(GOOGLE_BOOKS_API_KEY),
      metron: Boolean(METRON_USERNAME && METRON_PASSWORD),
    },
  });
});

app.get("/api/self-test", async (_req, res) => {
  const results = {
    db: false,
    comicvine: null,
    openlibrary: null,
    googlebooks: null,
    metron: null,
  };

  try {
    await pool.query("SELECT 1");
    results.db = true;
  } catch (error) {
    results.db = false;
  }

  results.openlibrary = (await safeSearch(() => searchOpenLibraryByTitle("Batman"))).length > 0;
  results.googlebooks = (await safeSearch(() => searchGoogleBooksByTitle("Batman"))).length > 0;

  if (COMICVINE_API_KEY) {
    results.comicvine = (await safeSearch(() => searchComicVineByTitle("Batman", "1"))).length > 0;
  }

  if (METRON_USERNAME && METRON_PASSWORD) {
    results.metron = (await safeSearch(() => searchMetronByTitle("Batman", "1"))).length > 0;
  }

  res.json({ results });
});

app.get("/api/search", async (req, res) => {
  const title = req.query.title;
  const issue = normalizeIssueNumber(req.query.issue || "");

  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const [comicVineResults, openLibraryResults, googleResults, metronResults] = await Promise.all([
      safeSearch(() => searchComicVineByTitle(title, issue)),
      safeSearch(() => searchOpenLibraryByTitle(title)),
      safeSearch(() => searchGoogleBooksByTitle(title)),
      safeSearch(() => searchMetronByTitle(title, issue)),
    ]);

    const combined = [...metronResults, ...comicVineResults, ...openLibraryResults, ...googleResults];
    res.json({ results: combined });
  } catch (error) {
    res.status(500).json({ error: "Search failed." });
  }
});

app.get("/api/barcode", async (req, res) => {
  const barcode = req.query.barcode;
  if (!barcode) {
    return res.status(400).json({ error: "barcode is required" });
  }

  try {
    const cleaned = String(barcode).replace(/[^0-9X]/gi, "");
    let results = [];

    if (cleaned.length === 10 || cleaned.length === 13) {
      results = await safeSearch(() => searchOpenLibraryByIsbn(cleaned));
    }

    if (!results.length) {
      results = await safeSearch(() => searchGoogleBooksByIsbn(cleaned));
    }

    if (!results.length) {
      results = await safeSearch(() => searchMetronByUpc(cleaned));
    }

    if (!results.length && COMICVINE_API_KEY) {
      results = await safeSearch(() => searchComicVineByTitle(barcode, ""));
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: "Barcode lookup failed." });
  }
});

app.get("/api/comics", async (req, res) => {
  const isOwned = req.query.owned === "true";
  try {
    const result = await pool.query(
      "SELECT * FROM comics WHERE is_owned = $1 ORDER BY created_at DESC",
      [isOwned]
    );
    res.json({ results: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch comics." });
  }
});

app.get("/api/export", async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  try {
    const result = await pool.query("SELECT * FROM comics ORDER BY created_at DESC");
    if (format === "clz-csv") {
      const headers = [
        "Series",
        "Issue",
        "Issue Title",
        "Variant Description",
        "Publisher",
        "Release Date",
        "Cover Date",
        "Publication Date",
        "Format",
        "Added Date",
        "Cover Price",
        "Cover Currency",
        "Page Count",
        "Age",
        "Language",
        "Country",
        "Key Reason",
        "Series Group",
        "Collection Name",
        "Collection Hash",
        "Quantity",
        "Cover URL",
        "Synopsis",
        "Grade",
        "Barcode",
        "Notes"
      ];
      const rows = result.rows.map((row) => [
        row.series || row.title || "",
        row.issue_number || "",
        row.issue_title || "",
        row.variant_description || "",
        row.publisher || "",
        formatClzDisplayDate(row.release_date) || "",
        formatClzDisplayDate(row.cover_date) || "",
        formatClzDisplayDate(row.publication_date) || "",
        row.format || "",
        formatClzDisplayDate(row.added_date) || "",
        row.cover_price || "",
        row.cover_currency || "",
        row.page_count || "",
        row.age || "",
        row.language || "",
        row.country || "",
        row.key_reason || "",
        row.series_group || "",
        row.collection_name || "",
        row.collection_hash || "",
        row.quantity || "",
        row.cover_url || "",
        row.synopsis || "",
        row.grade || "",
        row.barcode || "",
        row.notes || ""
      ]);
      const csv = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"noir-clz-export.csv\"");
      return res.send(csv);
    }
    if (format === "clz-xml") {
      const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
      const xml = builder.build({
        collectorz: {
          meta: {
            scope: "export",
            action: "export",
          },
          data: {
            comicinfo: {
              comiclist: {
                comic: result.rows.map((row) => {
                  const { issuenr, issueext } = splitIssueNumber(row.issue_number);
                  return {
                  datasetversion: 12,
                  mainsection: {
                    title: row.issue_title || "",
                    series: {
                      displayname: row.series || row.title || "",
                    },
                    plot: row.synopsis || "",
                    pagecount: row.page_count || "",
                  },
                  issuenr: issuenr || "",
                  issueext: issueext || "",
                  edition: {
                    displayname: row.variant_description || "",
                  },
                  seriesgroup: {
                    displayname: row.series_group || "",
                  },
                  publisher: {
                    displayname: row.publisher || "",
                  },
                  coverdate: formatClzDateStruct(row.cover_date) || "",
                  releasedate: formatClzDateStruct(row.release_date) || "",
                  publicationdate: formatClzDateStruct(row.publication_date) || "",
                  addeddate: row.added_date
                    ? { timestamp: Math.floor(new Date(row.added_date).getTime() / 1000) }
                    : "",
                  barcode: row.barcode || "",
                  format: {
                    displayname: row.format || "",
                  },
                  coverfrontdefault: row.cover_url || "",
                  quantity: row.quantity || 1,
                  collectionstatus: row.is_owned ? "In Collection" : "In Wishlist",
                  age: {
                    displayname: row.age || "",
                  },
                  coverprice: row.cover_price || "",
                  grade: {
                    rating: row.grade || "",
                  },
                  iskeycomic: row.is_key ? "Yes" : "No",
                  keycomicreason: row.key_reason || "",
                  country: {
                    displayname: row.country || "",
                  },
                  language: {
                    displayname: row.language || "",
                  },
                  collection: {
                    displayname: row.collection_name || "",
                    hash: row.collection_hash || "",
                  },
                };
                }),
              },
            },
          },
        },
      });
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", "attachment; filename=\"noir-clz-export.xml\"");
      return res.send(xml);
    }
    if (format === "xml") {
      const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
      const xml = builder.build({
        comics: {
          comic: result.rows.map((row) => ({
            id: row.id,
            title: row.title,
            series: row.series,
            issue_number: row.issue_number,
            publisher: row.publisher,
            grade: row.grade,
            signature_status: row.signature_status,
            slab_status: row.slab_status,
            is_key: row.is_key,
            is_owned: row.is_owned,
            cover_url: row.cover_url,
            barcode: row.barcode,
            notes: row.notes,
            release_date: row.release_date,
            synopsis: row.synopsis,
            issue_title: row.issue_title,
            variant_description: row.variant_description,
            format: row.format,
            added_date: row.added_date,
            cover_price: row.cover_price,
            cover_currency: row.cover_currency,
            page_count: row.page_count,
            age: row.age,
            language: row.language,
            country: row.country,
            key_reason: row.key_reason,
            series_group: row.series_group,
            collection_name: row.collection_name,
            collection_hash: row.collection_hash,
            quantity: row.quantity,
            cover_date: row.cover_date,
            publication_date: row.publication_date,
            metadata: row.metadata,
          })),
        },
      });
      res.setHeader("Content-Type", "application/xml");
      return res.send(xml);
    }
    res.json({ results: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Failed to export." });
  }
});

app.post("/api/comics", async (req, res) => {
  const payload = req.body;
  if (!payload.title || !payload.issueNumber) {
    return res.status(400).json({ error: "title and issueNumber are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comics (
        title, issue_number, publisher, grade, signature_status, slab_status,
        is_key, is_owned, cover_url, barcode, notes, series, volume, release_date, synopsis,
        issue_title, variant_description, format, added_date, cover_price, cover_currency, page_count,
        age, language, country, key_reason, series_group, collection_name, collection_hash, quantity,
        cover_date, publication_date,
        metron_issue_id, metron_series_id, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
      ON CONFLICT (title, issue_number, publisher, is_owned)
      DO UPDATE SET
        grade = EXCLUDED.grade,
        signature_status = EXCLUDED.signature_status,
        slab_status = EXCLUDED.slab_status,
        is_key = EXCLUDED.is_key,
        cover_url = EXCLUDED.cover_url,
        barcode = EXCLUDED.barcode,
        notes = EXCLUDED.notes,
        series = EXCLUDED.series,
        volume = EXCLUDED.volume,
        release_date = EXCLUDED.release_date,
        synopsis = EXCLUDED.synopsis,
        issue_title = EXCLUDED.issue_title,
        variant_description = EXCLUDED.variant_description,
        format = EXCLUDED.format,
        added_date = EXCLUDED.added_date,
        cover_price = EXCLUDED.cover_price,
        cover_currency = EXCLUDED.cover_currency,
        page_count = EXCLUDED.page_count,
        age = EXCLUDED.age,
        language = EXCLUDED.language,
        country = EXCLUDED.country,
        key_reason = EXCLUDED.key_reason,
        series_group = EXCLUDED.series_group,
        collection_name = EXCLUDED.collection_name,
        collection_hash = EXCLUDED.collection_hash,
        quantity = EXCLUDED.quantity,
        cover_date = EXCLUDED.cover_date,
        publication_date = EXCLUDED.publication_date,
        metron_issue_id = EXCLUDED.metron_issue_id,
        metron_series_id = EXCLUDED.metron_series_id,
        metadata = EXCLUDED.metadata
      RETURNING *`,
      [
        payload.title,
        normalizeIssueNumber(payload.issueNumber),
        payload.publisher || null,
        payload.grade || null,
        payload.signatureStatus || "none",
        payload.slabStatus || "raw",
        Boolean(payload.isKey),
        payload.isOwned !== undefined ? Boolean(payload.isOwned) : true,
        payload.coverUrl || null,
        payload.barcode || null,
        payload.notes || null,
        payload.series || null,
        payload.volume || null,
        parseReleaseDate(payload.releaseDate || payload.release_date),
        payload.synopsis || null,
        payload.issueTitle || payload.issue_title || null,
        payload.variantDescription || payload.variant_description || null,
        payload.format || null,
        parseReleaseDate(payload.addedDate || payload.added_date),
        parseNumber(payload.coverPrice || payload.cover_price),
        payload.coverCurrency || payload.cover_currency || null,
        parseNumber(payload.pageCount || payload.page_count),
        payload.age || null,
        payload.language || null,
        payload.country || null,
        payload.keyReason || payload.key_reason || null,
        payload.seriesGroup || payload.series_group || null,
        payload.collectionName || payload.collection_name || null,
        payload.collectionHash || payload.collection_hash || null,
        parseNumber(payload.quantity),
        parseReleaseDate(payload.coverDate || payload.cover_date),
        parseReleaseDate(payload.publicationDate || payload.publication_date),
        payload.metronIssueId || payload.metron_issue_id || null,
        payload.metronSeriesId || payload.metron_series_id || null,
        payload.metadata || {},
      ]
    );
    res.status(201).json({ result: result.rows[0] });
  } catch (error) {
    console.error("Create comic failed:", error);
    res.status(500).json({ error: "Failed to create comic." });
  }
});

app.post("/api/import", async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : req.body.entries;
  const replace = Boolean(req.body?.replace);
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "entries array is required" });
  }

  try {
    const client = await pool.connect();
    const normalized = entries.map((entry) => ({
      title: entry.title,
      issueNumber: normalizeIssueNumber(entry.issueNumber),
      publisher: entry.publisher || null,
      grade: entry.grade || null,
      signatureStatus: entry.signatureStatus || "none",
      slabStatus: entry.slabStatus || "raw",
      isKey: Boolean(entry.isKey),
      isOwned: entry.isOwned !== undefined ? Boolean(entry.isOwned) : true,
      coverUrl: entry.coverUrl || null,
      barcode: entry.barcode || null,
      notes: entry.notes || null,
      series: entry.series || null,
      volume: entry.volume || null,
      releaseDate: parseReleaseDate(entry.releaseDate || entry.release_date),
      metronIssueId: entry.metronIssueId || entry.metron_issue_id || null,
      metronSeriesId: entry.metronSeriesId || entry.metron_series_id || null,
      issueTitle: entry.issueTitle || entry.issue_title || null,
      variantDescription: entry.variantDescription || entry.variant_description || null,
      format: entry.format || null,
      addedDate: parseReleaseDate(entry.addedDate || entry.added_date),
      coverPrice: parseNumber(entry.coverPrice || entry.cover_price),
      coverCurrency: entry.coverCurrency || entry.cover_currency || null,
      pageCount: parseNumber(entry.pageCount || entry.page_count),
      age: entry.age || null,
      language: entry.language || null,
      country: entry.country || null,
      keyReason: entry.keyReason || entry.key_reason || null,
      seriesGroup: entry.seriesGroup || entry.series_group || null,
      collectionName: entry.collectionName || entry.collection_name || null,
      collectionHash: entry.collectionHash || entry.collection_hash || null,
      quantity: parseNumber(entry.quantity),
      coverDate: parseReleaseDate(entry.coverDate || entry.cover_date),
      publicationDate: parseReleaseDate(entry.publicationDate || entry.publication_date),
      metadata: entry.metadata || {},
    }));

    const deduped = new Map();
    for (const entry of normalized) {
      const key = `${entry.title}||${entry.issueNumber}||${entry.publisher}||${entry.isOwned}`;
      deduped.set(key, entry);
    }

    const uniqueEntries = Array.from(deduped.values());
    const chunkSize = 300;
    let inserted = 0;
    await client.query("BEGIN");
    if (replace) {
      await client.query("TRUNCATE comics");
    }
    for (let i = 0; i < uniqueEntries.length; i += chunkSize) {
      const batch = uniqueEntries.slice(i, i + chunkSize);
      const { sql, values } = buildInsertQuery(batch);
      const result = await client.query(sql, values);
      inserted += result.rowCount;
    }
    // Remove duplicates, keep earliest by created_at
    await client.query(`
      WITH ranked AS (
        SELECT ctid,
          row_number() OVER (
            PARTITION BY title, issue_number, publisher, is_owned
            ORDER BY created_at ASC
          ) AS rn
        FROM comics
      )
      DELETE FROM comics
      WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1)
    `);
    await updateTitlesFromSeries(client);
    await client.query("COMMIT");
    client.release();

    res.json({ inserted, total: uniqueEntries.length, replaced: replace });
  } catch (error) {
    console.error("Import failed:", error);
    res.status(500).json({ error: "Import failed." });
  }
});

app.post("/api/import-xml", async (req, res) => {
  const xmlText = req.body?.xml;
  const replace = Boolean(req.body?.replace);
  if (!xmlText) {
    return res.status(400).json({ error: "xml is required" });
  }

  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xmlText);
    const comics =
      parsed?.collectorz?.data?.comicinfo?.comiclist?.comic ||
      parsed?.data?.comicinfo?.comiclist?.comic ||
      [];
    const list = Array.isArray(comics) ? comics : [comics];
    const entries = list.map(parseClzComic);

    const deduped = new Map();
    for (const entry of entries) {
      const key = `${entry.title}||${entry.issueNumber}||${entry.publisher}||${entry.isOwned}`;
      deduped.set(key, entry);
    }
    const uniqueEntries = Array.from(deduped.values());

    const client = await pool.connect();
    const chunkSize = 300;
    let inserted = 0;
    await client.query("BEGIN");
    if (replace) {
      await client.query("TRUNCATE comics");
    }
    for (let i = 0; i < uniqueEntries.length; i += chunkSize) {
      const batch = uniqueEntries.slice(i, i + chunkSize);
      const { sql, values } = buildInsertQuery(
        batch.map((entry) => ({
          ...entry,
          releaseDate: parseReleaseDate(entry.releaseDate),
          addedDate: parseReleaseDate(entry.addedDate),
          coverDate: parseReleaseDate(entry.coverDate),
          publicationDate: parseReleaseDate(entry.publicationDate),
        }))
      );
      const result = await client.query(sql, values);
      inserted += result.rowCount;
    }
    await client.query(`
      WITH ranked AS (
        SELECT ctid,
          row_number() OVER (
            PARTITION BY title, issue_number, publisher, is_owned
            ORDER BY created_at ASC
          ) AS rn
        FROM comics
      )
      DELETE FROM comics
      WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1)
    `);
    await updateTitlesFromSeries(client);
    await client.query("COMMIT");
    client.release();

    res.json({ inserted, total: uniqueEntries.length, replaced: replace });
  } catch (error) {
    console.error("XML import failed:", error);
    res.status(500).json({ error: "XML import failed." });
  }
});

app.post("/api/update", async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : req.body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "entries array is required" });
  }

  try {
    const normalized = entries.map((entry) => ({
      title: entry.title,
      issueNumber: normalizeIssueNumber(entry.issueNumber),
      publisher: entry.publisher || null,
      grade: entry.grade || null,
      signatureStatus: entry.signatureStatus || null,
      slabStatus: entry.slabStatus || null,
      isKey: entry.isKey ?? null,
      isOwned: entry.isOwned !== undefined ? Boolean(entry.isOwned) : true,
      coverUrl: entry.coverUrl || null,
      barcode: entry.barcode || null,
      notes: entry.notes || null,
      series: entry.series || null,
      volume: entry.volume || null,
      releaseDate: parseReleaseDate(entry.releaseDate || entry.release_date),
      synopsis: entry.synopsis || null,
      metronIssueId: entry.metronIssueId || entry.metron_issue_id || null,
      metronSeriesId: entry.metronSeriesId || entry.metron_series_id || null,
      issueTitle: entry.issueTitle || entry.issue_title || null,
      variantDescription: entry.variantDescription || entry.variant_description || null,
      format: entry.format || null,
      addedDate: parseReleaseDate(entry.addedDate || entry.added_date),
      coverPrice: parseNumber(entry.coverPrice || entry.cover_price),
      coverCurrency: entry.coverCurrency || entry.cover_currency || null,
      pageCount: parseNumber(entry.pageCount || entry.page_count),
      age: entry.age || null,
      language: entry.language || null,
      country: entry.country || null,
      keyReason: entry.keyReason || entry.key_reason || null,
      seriesGroup: entry.seriesGroup || entry.series_group || null,
      collectionName: entry.collectionName || entry.collection_name || null,
      collectionHash: entry.collectionHash || entry.collection_hash || null,
      quantity: parseNumber(entry.quantity),
      coverDate: parseReleaseDate(entry.coverDate || entry.cover_date),
      publicationDate: parseReleaseDate(entry.publicationDate || entry.publication_date),
      metadata: entry.metadata || null,
    }));

    const deduped = new Map();
    for (const entry of normalized) {
      const key = `${entry.title}||${entry.issueNumber}||${entry.publisher}||${entry.isOwned}`;
      deduped.set(key, entry);
    }
    const uniqueEntries = Array.from(deduped.values());

    const chunkSize = 300;
    let updated = 0;
    for (let i = 0; i < uniqueEntries.length; i += chunkSize) {
      const batch = uniqueEntries.slice(i, i + chunkSize);
      const { sql, values } = buildUpdateQuery(batch);
      const result = await pool.query(sql, values);
      updated += result.rowCount;
    }

    res.json({ updated, notFound: uniqueEntries.length - updated, total: uniqueEntries.length });
  } catch (error) {
    console.error("Update failed:", error);
    res.status(500).json({ error: "Update failed." });
  }
});

app.put("/api/comics/:id", async (req, res) => {
  const payload = req.body;
  try {
    const result = await pool.query(
      `UPDATE comics SET
        title = $1,
        issue_number = $2,
        publisher = $3,
        grade = $4,
        signature_status = $5,
        slab_status = $6,
        is_key = $7,
        is_owned = $8,
        cover_url = $9,
        barcode = $10,
        notes = $11,
        series = $12,
        volume = $13,
        release_date = $14,
        synopsis = $15,
        metadata = $16
      WHERE id = $17
      RETURNING *`,
      [
        payload.title,
        normalizeIssueNumber(payload.issueNumber),
        payload.publisher || null,
        payload.grade || null,
        payload.signatureStatus || "none",
        payload.slabStatus || "raw",
        Boolean(payload.isKey),
        payload.isOwned !== undefined ? Boolean(payload.isOwned) : true,
        payload.coverUrl || null,
        payload.barcode || null,
        payload.notes || null,
        payload.series || null,
        payload.volume || null,
        parseReleaseDate(payload.releaseDate || payload.release_date),
        payload.synopsis || null,
        payload.metadata || {},
        req.params.id,
      ]
    );
    res.json({ result: result.rows[0] });
  } catch (error) {
    console.error("Update comic failed:", error);
    res.status(500).json({ error: "Failed to update comic." });
  }
});

app.delete("/api/comics/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM comics WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete comic." });
  }
});

// Bulk Auto-Match endpoint - fetches covers and synopsis for multiple comics
app.post("/api/bulk-enrich", async (req, res) => {
  try {
    const { limit = 50 } = req.body;
    
    // Get comics missing cover or synopsis
    const result = await pool.query(
      `SELECT id, title, series, issue_number, cover_url, synopsis 
       FROM comics 
       WHERE cover_url IS NULL OR synopsis IS NULL 
       ORDER BY title, issue_number 
       LIMIT $1`,
      [limit]
    );

    const comics = result.rows;
    const results = { updated: 0, skipped: 0, errors: 0, total: comics.length };

    for (const comic of comics) {
      try {
        let matched = null;
        if (comic.barcode) {
          const cleaned = String(comic.barcode).replace(/[^0-9X]/gi, "");
          if (cleaned.length === 10 || cleaned.length === 13) {
            const isbnResults = await searchOpenLibraryByIsbn(cleaned);
            if (isbnResults && isbnResults.length > 0) {
              matched = isbnResults[0];
            }
          }
        }

        if (!matched) {
          const searchTitle = comic.series || comic.title;
          const candidates = await safeSearch(() => searchComicVineByTitle(searchTitle, comic.issue_number));
          matched = selectBestCandidate(candidates, searchTitle, comic.issue_number);
        }

        if (!matched) {
          const searchTitle = comic.series || comic.title;
          const googleCandidates = await safeSearch(() => searchGoogleBooksByTitle(searchTitle));
          matched = selectBestCandidate(googleCandidates, searchTitle, comic.issue_number);
        }

        if (!matched) {
          const searchTitle = comic.series || comic.title;
          const metronCandidates = await safeSearch(() =>
            searchMetronByTitle(searchTitle, comic.issue_number, comic.publisher)
          );
          matched = selectBestCandidate(metronCandidates, searchTitle, comic.issue_number);
        }
        
        if (!matched || (!matched.coverUrl && !matched.synopsis)) {
          results.errors++;
          continue;
        }

        // Update only if we have new data
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (matched.coverUrl && !comic.cover_url) {
          updateFields.push(`cover_url = $${paramIndex++}`);
          updateValues.push(matched.coverUrl);
        }

        if (matched.synopsis && !comic.synopsis) {
          updateFields.push(`synopsis = $${paramIndex++}`);
          updateValues.push(matched.synopsis);
        }

        if (updateFields.length > 0) {
          updateValues.push(comic.id);
          await pool.query(
            `UPDATE comics SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
            updateValues
          );
          results.updated++;
        } else {
          results.skipped++;
        }

        // Rate limiting - 1 request per second
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error enriching comic ${comic.id}:`, error.message);
        results.errors++;
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Bulk enrich failed:", error);
    res.status(500).json({ error: "Failed to bulk enrich comics." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on ${PORT}`);
});
