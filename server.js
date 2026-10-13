const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

const FF_ORIGIN = "https://matchstats.sea.ffesports.com";
const FF_API = `${FF_ORIGIN}/api/match_stats/match_data`;

const SIGN_PREFIX =
  "88KwGROQXqR5jydLJbUZX97xpHyjqaIpPzx/ubjl3GPffamZ0mjz/g";

/*
 * =========================================================
 * GOOGLE DRIVE API KEY
 * =========================================================
 *
 * Cách 1:
 *   set GOOGLE_DRIVE_API_KEY=API_KEY_CUA_BAN
 *   node server.js
 *
 * Cách 2:
 *   Có thể điền trực tiếp API key vào chuỗi bên dưới.
 *
 * Khuyến nghị dùng biến môi trường để không lộ API key.
 */
const GOOGLE_DRIVE_API_KEY =
  process.env.GOOGLE_DRIVE_API_KEY || "";

const PUBLIC = path.join(__dirname, "public");


/* =========================================================
   FREE FIRE SIGN
========================================================= */

function md5(value) {
  return crypto
    .createHash("md5")
    .update(value, "utf8")
    .digest("hex");
}


function createPayload(matchIds) {
  const data = {
    match_ids: matchIds.map(String),
    single_match_id: [],
    _ts: Math.floor(Date.now() / 1000)
  };

  const signText = Object.keys(data)
    .map(key => `${key}=${data[key]}`)
    .sort()
    .join("");

  data._sign =
    md5(SIGN_PREFIX + signText);

  return data;
}


/* =========================================================
   FREE FIRE SESSION
========================================================= */

function parseSetCookies(headers) {
  let cookies = [];

  if (
    typeof headers.getSetCookie ===
    "function"
  ) {
    cookies =
      headers.getSetCookie();
  } else {
    const value =
      headers.get("set-cookie");

    if (value) {
      cookies = [value];
    }
  }

  return cookies
    .map(cookie =>
      cookie.split(";")[0]
    )
    .filter(Boolean)
    .join("; ");
}


function cookieValue(
  cookieHeader,
  name
) {
  if (!cookieHeader) {
    return "";
  }

  for (
    const cookie
    of cookieHeader.split(";")
  ) {
    const [
      key,
      ...value
    ] =
      cookie
        .trim()
        .split("=");

    if (key === name) {
      return decodeURIComponent(
        value.join("=")
      );
    }
  }

  return "";
}


async function createSession() {
  const response =
    await fetch(
      `${FF_ORIGIN}/`,
      {
        redirect: "follow",

        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
        }
      }
    );

  return parseSetCookies(
    response.headers
  );
}


/* =========================================================
   FREE FIRE MATCH API
========================================================= */

async function requestMatchStats(
  matchIds
) {
  const payload =
    createPayload(matchIds);

  const cookie =
    await createSession();

  const csrf =
    cookieValue(
      cookie,
      "csrftoken"
    );

  const headers = {
    accept:
      "application/json, text/plain, */*",

    "content-type":
      "application/json;charset=UTF-8",

    origin:
      FF_ORIGIN,

    referer:
      `${FF_ORIGIN}/`,

    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
  };

  if (cookie) {
    headers.cookie = cookie;
  }

  if (csrf) {
    headers["x-csrftoken"] =
      csrf;
  }

  console.log("");
  console.log("MATCH REQUEST");
  console.log(payload);

  const response =
    await fetch(
      FF_API,
      {
        method: "POST",
        headers,
        body:
          JSON.stringify(
            payload
          )
      }
    );

  const text =
    await response.text();

  let json;

  try {
    json =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Match Stats trả về dữ liệu không phải JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Match Stats HTTP ${response.status}: ${JSON.stringify(json)}`
    );
  }

  return {
    payload,
    response: json
  };
}


/* =========================================================
   GOOGLE DRIVE
========================================================= */

function requireDriveApiKey() {
  if (!GOOGLE_DRIVE_API_KEY) {
    throw new Error(
      "Chưa cấu hình GOOGLE_DRIVE_API_KEY."
    );
  }

  return GOOGLE_DRIVE_API_KEY;
}


/*
 * Nhận:
 *
 * https://drive.google.com/drive/folders/ABC123
 *
 * hoặc:
 *
 * https://drive.google.com/open?id=ABC123
 *
 * hoặc nhập trực tiếp Folder ID.
 */
function extractDriveFolderId(value) {
  const input =
    String(value || "").trim();

  if (!input) {
    return "";
  }

  /*
   * Nhập trực tiếp ID.
   */
  if (
    /^[A-Za-z0-9_-]{10,}$/.test(
      input
    )
  ) {
    return input;
  }

  let url;

  try {
    url = new URL(input);
  } catch {
    return "";
  }

  /*
   * Link dạng:
   *
   * /drive/folders/FOLDER_ID
   */
  const folderMatch =
    url.pathname.match(
      /\/folders\/([A-Za-z0-9_-]+)/
    );

  if (folderMatch) {
    return folderMatch[1];
  }

  /*
   * Link dạng:
   *
   * ?id=FOLDER_ID
   */
  const id =
    url.searchParams.get("id");

  if (
    id &&
    /^[A-Za-z0-9_-]{10,}$/.test(id)
  ) {
    return id;
  }

  return "";
}


/*
 * Các loại ảnh cho phép.
 */
function isImageMimeType(
  mimeType
) {
  return [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
  ].includes(
    String(mimeType || "")
      .toLowerCase()
  );
}


/*
 * Đọc toàn bộ ảnh trong thư mục Drive.
 */
async function listPublicDriveImages(
  folderId
) {
  const apiKey =
    requireDriveApiKey();

  const files = [];

  let pageToken = "";

  do {
    const params =
      new URLSearchParams({
        q:
          `'${folderId}' in parents and trashed = false`,

        fields:
          "nextPageToken,files(id,name,mimeType,size,resourceKey)",

        pageSize:
          "1000",

        supportsAllDrives:
          "true",

        includeItemsFromAllDrives:
          "true",

        key:
          apiKey
      });

    if (pageToken) {
      params.set(
        "pageToken",
        pageToken
      );
    }

    const response =
      await fetch(
        "https://www.googleapis.com/drive/v3/files?" +
        params.toString(),
        {
          headers: {
            accept:
              "application/json"
          }
        }
      );

    const text =
      await response.text();

    let json;

    try {
      json =
        JSON.parse(text);
    } catch {
      throw new Error(
        `Google Drive trả về dữ liệu không hợp lệ. HTTP ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        json?.error?.message ||
        "Google Drive API báo lỗi."
      );
    }

    const current =
      Array.isArray(json.files)
        ? json.files
        : [];

    for (
      const file
      of current
    ) {
      if (
        !isImageMimeType(
          file.mimeType
        )
      ) {
        continue;
      }

      files.push({
        id:
          String(file.id),

        name:
          String(
            file.name || ""
          ),

        mimeType:
          String(
            file.mimeType || ""
          ),

        size:
          file.size
            ? Number(file.size)
            : null,

        resourceKey:
          String(
            file.resourceKey || ""
          )
      });
    }

    pageToken =
      json.nextPageToken || "";

  } while (pageToken);

  return files;
}


/*
 * Backend tải ảnh Drive.
 *
 * Frontend không gọi trực tiếp Google Drive
 * để tránh vấn đề CORS và giữ API key ở server.
 */
async function downloadDriveImage(
  fileId,
  resourceKey = ""
) {
  const apiKey =
    requireDriveApiKey();

  if (
    !/^[A-Za-z0-9_-]+$/.test(
      fileId
    )
  ) {
    throw new Error(
      "Google Drive File ID không hợp lệ."
    );
  }

  const params =
    new URLSearchParams({
      alt: "media",
      key: apiKey
    });

  const headers = {
    accept:
      "image/*,*/*;q=0.8"
  };

  if (resourceKey) {
    headers[
      "X-Goog-Drive-Resource-Keys"
    ] =
      `${fileId}/${resourceKey}`;
  }

  const response =
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      {
        headers,
        redirect: "follow"
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    let message =
      `Không tải được ảnh Google Drive. HTTP ${response.status}`;

    try {
      const json =
        JSON.parse(text);

      message =
        json?.error?.message ||
        message;
    } catch {}

    throw new Error(message);
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    "application/octet-stream";

  if (
    !contentType
      .toLowerCase()
      .startsWith("image/")
  ) {
    throw new Error(
      "File Google Drive không phải ảnh."
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return {
    buffer,
    contentType
  };
}


/* =========================================================
   JSON
========================================================= */

function sendJSON(
  res,
  status,
  value
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    JSON.stringify(value)
  );
}


async function readJSONBody(
  req
) {
  let raw = "";

  for await (
    const chunk
    of req
  ) {
    raw += chunk;

    if (
      raw.length >
      16000000
    ) {
      throw new Error(
        "Request quá lớn (tối đa khoảng 16 MB)."
      );
    }
  }

  try {
    return JSON.parse(
      raw || "{}"
    );
  } catch {
    throw new Error(
      "JSON không hợp lệ."
    );
  }
}


/* =========================================================
   STATIC FILE
========================================================= */

const mime = {
  ".html":
    "text/html; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

  ".js":
    "application/javascript; charset=utf-8",

  ".json":
    "application/json; charset=utf-8",

  ".png":
    "image/png",

  ".jpg":
    "image/jpeg",

  ".jpeg":
    "image/jpeg",

  ".svg":
    "image/svg+xml",

  ".webp":
    "image/webp"
};


function staticFile(
  req,
  res,
  pathname
) {
  const relative =
    pathname === "/"
      ? "index.html"
      : pathname.replace(
          /^\/+/,
          ""
        );

  const file =
    path.resolve(
      PUBLIC,
      relative
    );

  if (
    file !== PUBLIC &&
    !file.startsWith(
      PUBLIC + path.sep
    )
  ) {
    res.writeHead(403);

    res.end(
      "Forbidden"
    );

    return;
  }

  fs.readFile(
    file,
    (
      error,
      data
    ) => {
      if (error) {
        res.writeHead(404);

        res.end(
          "Not found"
        );

        return;
      }

      res.writeHead(
        200,
        {
          "Content-Type":
            mime[
              path
                .extname(file)
                .toLowerCase()
            ] ||
            "application/octet-stream"
        }
      );

      res.end(data);
    }
  );
}


/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const url =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );


        /* =================================================
           FREE FIRE MATCH
        ================================================= */

        if (
          req.method === "POST" &&
          url.pathname ===
            "/api/match"
        ) {
          let body;

          try {
            body =
              await readJSONBody(
                req
              );
          } catch (error) {
            return sendJSON(
              res,
              400,
              {
                ok: false,
                error:
                  error.message
              }
            );
          }

          const matchIds =
            Array.isArray(
              body.match_ids
            )
              ? body.match_ids
                  .map(String)
                  .map(value =>
                    value.trim()
                  )
                  .filter(Boolean)
              : [];

          if (!matchIds.length) {
            return sendJSON(
              res,
              400,
              {
                ok: false,

                error:
                  "Chưa nhập Match ID."
              }
            );
          }

          if (
            matchIds.some(
              id =>
                !/^\d{10,25}$/.test(
                  id
                )
            )
          ) {
            return sendJSON(
              res,
              400,
              {
                ok: false,

                error:
                  "Có Match ID không hợp lệ."
              }
            );
          }

          const result =
            await requestMatchStats(
              matchIds
            );

          return sendJSON(
            res,
            200,
            {
              ok: true,

              request:
                result.payload,

              data:
                result.response
            }
          );
        }


        /* =================================================
           GOOGLE DRIVE - ĐỌC THƯ MỤC
        ================================================= */

        if (
          req.method === "POST" &&
          url.pathname ===
            "/api/drive-logos"
        ) {
          let body;

          try {
            body =
              await readJSONBody(
                req
              );
          } catch (error) {
            return sendJSON(
              res,
              400,
              {
                ok: false,

                error:
                  error.message
              }
            );
          }

          const folderId =
            extractDriveFolderId(
              body.folder_url ||
              body.folderId
            );

          if (!folderId) {
            return sendJSON(
              res,
              400,
              {
                ok: false,

                error:
                  "Link thư mục Google Drive không hợp lệ."
              }
            );
          }

          try {
            const files =
              await listPublicDriveImages(
                folderId
              );

            return sendJSON(
              res,
              200,
              {
                ok: true,

                folderId,

                count:
                  files.length,

                files
              }
            );

          } catch (error) {

            return sendJSON(
              res,
              502,
              {
                ok: false,

                error:
                  error.message
              }
            );
          }
        }


        /* =================================================
           GOOGLE DRIVE - TẢI ẢNH
        ================================================= */

        if (
          req.method === "GET" &&
          url.pathname ===
            "/api/drive-image"
        ) {
          const fileId =
            String(
              url.searchParams.get(
                "id"
              ) || ""
            ).trim();

          const resourceKey =
            String(
              url.searchParams.get(
                "resourceKey"
              ) || ""
            ).trim();

          if (!fileId) {
            return sendJSON(
              res,
              400,
              {
                ok: false,

                error:
                  "Thiếu Google Drive File ID."
              }
            );
          }

          try {
            const image =
              await downloadDriveImage(
                fileId,
                resourceKey
              );

            res.writeHead(
              200,
              {
                "Content-Type":
                  image.contentType,

                "Content-Length":
                  image.buffer.length,

                "Cache-Control":
                  "public, max-age=3600"
              }
            );

            res.end(
              image.buffer
            );

            return;

          } catch (error) {

            return sendJSON(
              res,
              502,
              {
                ok: false,

                error:
                  error.message
              }
            );
          }
        }


        /* =================================================
           HEALTH CHECK
        ================================================= */

        if (
          req.method === "GET" &&
          url.pathname ===
            "/health"
        ) {
          return sendJSON(
            res,
            200,
            {
              ok: true,

              googleDriveConfigured:
                Boolean(
                  GOOGLE_DRIVE_API_KEY
                ),

              scoreboardOCR: "Tesseract.js (trình duyệt, không cần API key)"
            }
          );
        }


        /* =================================================
           STATIC WEBSITE
        ================================================= */

        staticFile(
          req,
          res,
          decodeURIComponent(
            url.pathname
          )
        );

      } catch (error) {

        console.error(
          error
        );

        sendJSON(
          res,
          500,
          {
            ok: false,

            error:
              error.message ||
              "Server error"
          }
        );
      }
    }
  );


server.listen(
  PORT,
  "127.0.0.1",
  () => {
    console.log("");

    console.log(
      "FF STANDINGS"
    );

    console.log(
      `http://127.0.0.1:${PORT}`
    );

    console.log(
      `Google Drive API: ${
        GOOGLE_DRIVE_API_KEY
          ? "READY"
          : "CHƯA CẤU HÌNH"
      }`
    );

    console.log(
      "Scoreboard OCR: Tesseract.js (browser)"
    );

    console.log("");
  }
);