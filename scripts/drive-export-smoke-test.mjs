import {
  DRIVE_EXPORT_CONFIG,
  buildMultipartUploadRequest,
  chooseDriveUploadType,
  connectGoogleDrive,
  disconnectGoogleDrive,
  getDriveExportStatus,
  readDriveOAuthConfiguration,
  uploadReviewedImageToDrive
} from "../drive-export.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_ORIGINS = [
  "https://www.googleapis.com/*",
  "https://content.googleapis.com/*"
];
const manifest = {
  oauth2: {
    client_id: "123456789-lumen.apps.googleusercontent.com",
    scopes: [DRIVE_SCOPE]
  }
};
let permissionGranted = false;
let originGranted = false;
let token = "drive-token-1";
let requestCount = 0;
let removedToken = "";
let checkedOrigins = [];
let requestedOrigins = [];
let removedOrigins = [];

const chromeApi = {
  runtime: {
    getManifest: () => manifest,
    lastError: null
  },
  permissions: {
    contains(query, callback) {
      if (query.origins) {
        checkedOrigins = [...query.origins];
      }
      callback(query.permissions ? permissionGranted : originGranted);
    },
    request(query, callback) {
      requestedOrigins = [...(query.origins || [])];
      permissionGranted = true;
      originGranted = true;
      callback(true);
    },
    remove(query, callback) {
      removedOrigins = [...(query.origins || [])];
      permissionGranted = false;
      originGranted = false;
      callback(true);
    }
  },
  identity: {
    async getAuthToken({ interactive }) {
      if (!permissionGranted && !interactive) {
        throw new Error("interaction required");
      }
      return { token, grantedScopes: [DRIVE_SCOPE] };
    },
    async removeCachedAuthToken({ token: value }) {
      removedToken = value;
    }
  }
};

const missing = readDriveOAuthConfiguration({});
assert(!missing.configured, "A missing OAuth client must fail closed.", missing);

const ready = readDriveOAuthConfiguration(manifest);
assert(ready.configured && ready.scopeReady, "A valid Drive OAuth manifest was not recognized.", ready);
assert(sameMembers(DRIVE_EXPORT_CONFIG.origins, DRIVE_ORIGINS), "Drive export configuration must declare both upload origins.", DRIVE_EXPORT_CONFIG);

const initialStatus = await getDriveExportStatus({ chromeApi, manifest });
assert(initialStatus.configured && !initialStatus.connected, "Drive should start disconnected.", initialStatus);
assert(sameMembers(checkedOrigins, DRIVE_ORIGINS), "Drive status did not check both upload origins.", { checkedOrigins });

const connection = await connectGoogleDrive({ chromeApi, manifest });
assert(connection.connected && permissionGranted && originGranted, "Drive consent did not grant the narrow permissions.", connection);
assert(sameMembers(requestedOrigins, DRIVE_ORIGINS), "Drive consent did not request both upload origins.", { requestedOrigins });

const imageBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], {
  type: "image/png"
});
const multipart = buildMultipartUploadRequest({
  blob: imageBlob,
  metadata: { name: "review.png" },
  boundary: "lumen_test_boundary"
});
const multipartText = await multipart.body.text();
assert(multipart.contentType === "multipart/related; boundary=lumen_test_boundary", "Multipart content type is incorrect.");
assert(multipartText.includes('"name":"review.png"'), "Multipart metadata is missing.");
assert(multipartText.includes("Content-Type: image/png"), "Multipart media type is missing.");
assert(chooseDriveUploadType(imageBlob.size) === "multipart", "Small reviewed images should use multipart upload.");
assert(chooseDriveUploadType(5 * 1024 * 1024 + 1) === "resumable", "Large reviewed images should use resumable upload.");

const upload = await uploadReviewedImageToDrive({
  blob: imageBlob,
  filename: "My reviewed capture",
  captureId: "capture-1",
  sourceUrl: "https://example.com/private?token=hidden"
}, {
  chromeApi,
  manifest,
  async fetchImpl(url, options) {
    requestCount += 1;
    assert(url.includes("upload/drive/v3/files"), "Unexpected Drive upload URL.", { url });
    assert(options.headers.Authorization === `Bearer ${token}`, "Drive bearer token was not attached.");
    assert(options.body instanceof Blob, "Drive upload body should be a Blob.");
    return new Response(JSON.stringify({
      id: "drive-file-1",
      name: "My reviewed capture.png",
      mimeType: "image/png",
      size: String(imageBlob.size),
      webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
      createdTime: "2026-07-16T18:00:00.000Z"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});

assert(requestCount === 1, "Expected exactly one Drive upload request.", { requestCount });
assert(upload.file.id === "drive-file-1" && upload.file.webViewLink.includes("drive.google.com"), "Drive response was not normalized.", upload);

const rejectedLinkUpload = await uploadReviewedImageToDrive({
  blob: imageBlob,
  filename: "Rejected link capture.png"
}, {
  chromeApi,
  manifest,
  async fetchImpl() {
    return new Response(JSON.stringify({
      id: "drive-file-untrusted-link",
      name: "Rejected link capture.png",
      mimeType: "image/png",
      size: String(imageBlob.size),
      webViewLink: "https://evilgoogle.com/file/d/not-drive/view"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});
assert(rejectedLinkUpload.file.webViewLink === "", "Lookalike Google host was accepted as a Drive link.", rejectedLinkUpload);

const largeBlob = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });
let resumableStep = 0;
const resumableUpload = await uploadReviewedImageToDrive({
  blob: largeBlob,
  filename: "Large reviewed capture.png",
  captureId: "capture-large"
}, {
  chromeApi,
  manifest,
  async fetchImpl(url, options) {
    resumableStep += 1;

    if (resumableStep === 1) {
      assert(url.includes("uploadType=resumable"), "Large upload did not create a resumable session.", { url });
      assert(options.method === "POST" && options.headers["X-Upload-Content-Length"] === String(largeBlob.size), "Resumable session metadata is incorrect.");
      return new Response(null, {
        status: 200,
        headers: { Location: "https://content.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=lumen-test" }
      });
    }

    assert(resumableStep === 2, "Unexpected extra resumable request.", { resumableStep });
    assert(options.method === "PUT" && options.body === largeBlob, "Resumable upload did not send the reviewed image blob.");
    assert(!hasHeader(options.headers, "content-length"), "Resumable PUT must not set the forbidden Content-Length header.", options.headers);
    return new Response(JSON.stringify({
      id: "drive-file-large",
      name: "Large reviewed capture.png",
      mimeType: "image/png",
      size: String(largeBlob.size),
      webViewLink: "https://drive.google.com/file/d/drive-file-large/view"
    }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  }
});

assert(resumableStep === 2 && resumableUpload.file.id === "drive-file-large", "Resumable Drive upload did not complete.", resumableUpload);

const disconnected = await disconnectGoogleDrive({ chromeApi });
assert(disconnected.permissionRemoved && !permissionGranted && !originGranted, "Drive disconnect did not revoke local permissions.", disconnected);
assert(removedToken === token, "Drive disconnect did not remove the cached token.", { removedToken });
assert(sameMembers(removedOrigins, DRIVE_ORIGINS), "Drive disconnect did not revoke both upload origins.", { removedOrigins });

console.log(JSON.stringify({
  ok: true,
  configured: ready.configured,
  multipartBytes: multipart.body.size,
  uploadId: upload.file.id,
  resumableUploadId: resumableUpload.file.id,
  permissionRevoked: disconnected.permissionRemoved
}, null, 2));

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}

function sameMembers(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function hasHeader(headers, name) {
  const normalizedName = String(name).toLowerCase();

  if (headers instanceof Headers) {
    return headers.has(normalizedName);
  }

  return Object.keys(headers || {}).some((key) => key.toLowerCase() === normalizedName);
}
