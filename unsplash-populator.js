(() => {
  'use strict';

  const BASE_URL = 'https://api.unsplash.com';

  // ------------------------------------------------------------
  //  SCHEMA CREATION
  // ------------------------------------------------------------
  function initUnsplashSchema(db) {
    const schemaSQL = `
      CREATE TABLE unsplash_photos (
        photo_id TEXT PRIMARY KEY,
        photo_url TEXT,
        photo_image_url TEXT,
        photo_submitted_at TEXT,
        photo_featured INTEGER,
        photo_width INTEGER,
        photo_height INTEGER,
        photo_aspect_ratio REAL,
        photo_description TEXT,
        photographer_username TEXT,
        photographer_first_name TEXT,
        photographer_last_name TEXT,
        exif_camera_make TEXT,
        exif_camera_model TEXT,
        exif_iso INTEGER,
        exif_aperture_value TEXT,
        exif_focal_length TEXT,
        exif_exposure_time TEXT,
        photo_location_name TEXT,
        photo_location_latitude REAL,
        photo_location_longitude REAL,
        photo_location_country TEXT,
        photo_location_city TEXT,
        stats_views INTEGER,
        stats_downloads INTEGER,
        ai_description TEXT,
        ai_primary_landmark_name TEXT,
        ai_primary_landmark_latitude REAL,
        ai_primary_landmark_longitude REAL,
        ai_primary_landmark_confidence TEXT,
        blur_hash TEXT
      );
      CREATE TABLE unsplash_keywords (
        photo_id TEXT,
        keyword TEXT,
        ai_service_1_confidence REAL,
        ai_service_2_confidence REAL,
        suggested_by_user INTEGER,
        user_suggestion_source TEXT,
        suggested_by_ai_service_3 INTEGER,
        confirmed_by_ai_service_3 INTEGER,
        PRIMARY KEY (photo_id, keyword),
        FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
      );
      CREATE TABLE unsplash_collections (
        photo_id TEXT,
        collection_id TEXT,
        collection_title TEXT,
        photo_collected_at TEXT,
        collection_type TEXT,
        PRIMARY KEY (photo_id, collection_id),
        FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
      );
      CREATE TABLE unsplash_conversions (
        converted_at TEXT,
        conversion_type TEXT,
        keyword TEXT,
        photo_id TEXT,
        anonymous_user_id TEXT,
        conversion_country TEXT,
        device_type TEXT,
        search_orientation_filter TEXT,
        search_ordering TEXT,
        FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
      );
      CREATE TABLE unsplash_colors (
        photo_id TEXT,
        hex TEXT,
        red INTEGER,
        green INTEGER,
        blue INTEGER,
        keyword TEXT,
        ai_coverage REAL,
        ai_score REAL,
        PRIMARY KEY (photo_id, hex),
        FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
      );

      CREATE VIEW v_photo_keywords AS
      SELECT
        p.photo_id,
        p.photo_url,
        p.photographer_username,
        p.photo_submitted_at,
        p.stats_views,
        p.stats_downloads,
        k.keyword,
        k.ai_service_1_confidence,
        k.ai_service_2_confidence,
        k.suggested_by_user,
        k.user_suggestion_source
      FROM unsplash_photos p
      JOIN unsplash_keywords k ON p.photo_id = k.photo_id;

      CREATE VIEW v_photo_colors AS
      SELECT
        p.photo_id,
        p.photo_url,
        c.hex,
        c.red,
        c.green,
        c.blue,
        c.keyword AS color_keyword,
        c.ai_coverage,
        c.ai_score
      FROM unsplash_photos p
      JOIN unsplash_colors c ON p.photo_id = c.photo_id;

      CREATE VIEW v_photo_collections AS
      SELECT
        p.photo_id,
        p.photo_url,
        c.collection_id,
        c.collection_title,
        c.collection_type,
        c.photo_collected_at
      FROM unsplash_photos p
      JOIN unsplash_collections c ON p.photo_id = c.photo_id;

      CREATE VIEW v_photo_conversion_stats AS
      SELECT
        photo_id,
        COUNT(*) AS total_conversions,
        SUM(CASE WHEN conversion_type = 'download' THEN 1 ELSE 0 END) AS download_count,
        SUM(CASE WHEN conversion_type = 'click' THEN 1 ELSE 0 END) AS click_count,
        COUNT(DISTINCT anonymous_user_id) AS unique_users,
        COUNT(DISTINCT keyword) AS unique_keywords
      FROM unsplash_conversions
      GROUP BY photo_id;

      CREATE VIEW v_top_keywords AS
      SELECT
        keyword,
        COUNT(*) AS photo_count,
        AVG(ai_service_1_confidence) AS avg_conf_service1,
        AVG(ai_service_2_confidence) AS avg_conf_service2
      FROM unsplash_keywords
      GROUP BY keyword
      ORDER BY photo_count DESC;

      CREATE VIEW v_photos_with_stats AS
      SELECT
        p.*,
        COALESCE(c.total_conversions, 0) AS total_conversions,
        COALESCE(c.download_count, 0) AS download_count,
        COALESCE(c.unique_users, 0) AS unique_users
      FROM unsplash_photos p
      LEFT JOIN v_photo_conversion_stats c ON p.photo_id = c.photo_id;
    `;

    db.run(schemaSQL);
  }

  // ------------------------------------------------------------
  //  API FETCHING AND INSERTION
  // ------------------------------------------------------------
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string' || hex.length !== 6) return null;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }

  async function fetchPhotosPage(accessKey, page, perPage) {
    const url = `${BASE_URL}/photos?page=${page}&per_page=${perPage}`;
    const headers = { Authorization: `Client-ID ${accessKey}` };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`List request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async function fetchPhotoDetails(accessKey, photoId) {
    const url = `${BASE_URL}/photos/${photoId}?stats=true&exif=true&collections=public&tags=true`;
    const headers = { Authorization: `Client-ID ${accessKey}` };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Detail request failed for ${photoId}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  function insertPhoto(db, photo, detailData = null) {
    const p = detailData || photo;
    const photoId = p.id;
    const photoUrl = p.links?.html ?? null;
    const photoImageUrl = p.urls?.raw ?? p.urls?.full ?? null;
    const submittedAt = p.created_at ?? null;
    const photoFeatured = p.promoted_at ? 1 : 0;
    const width = p.width ?? null;
    const height = p.height ?? null;
    const aspectRatio = (width && height) ? width / height : null;
    const description = p.description ?? p.alt_description ?? null;
    const photographerUsername = p.user?.username ?? null;
    const photographerFirstName = p.user?.first_name ?? null;
    const photographerLastName = p.user?.last_name ?? null;
    const blurHash = p.blur_hash ?? null;

    const exif = p.exif ?? {};
    const exifCameraMake = exif.make ?? null;
    const exifCameraModel = exif.model ?? null;
    const exifIso = exif.iso ?? null;
    const exifAperture = exif.aperture ?? null;
    const exifFocalLength = exif.focal_length ?? null;
    const exifExposureTime = exif.exposure_time ?? null;

    const loc = p.location ?? {};
    const locName = loc.name ?? null;
    const locLat = loc.position?.latitude ?? null;
    const locLon = loc.position?.longitude ?? null;
    const locCountry = loc.country ?? null;
    const locCity = loc.city ?? null;

    const stats = p.stats ?? {};
    const statsViews = stats.views ?? null;
    const statsDownloads = stats.downloads ?? null;

    const aiDescription = p.ai_description ?? null;
    const aiLandmarkName = p.ai_primary_landmark_name ?? null;
    const aiLandmarkLat = p.ai_primary_landmark_latitude ?? null;
    const aiLandmarkLon = p.ai_primary_landmark_longitude ?? null;
    const aiLandmarkConfidence = p.ai_primary_landmark_confidence ?? null;

    db.run(
      `INSERT OR REPLACE INTO unsplash_photos (
        photo_id, photo_url, photo_image_url, photo_submitted_at,
        photo_featured, photo_width, photo_height, photo_aspect_ratio,
        photo_description, photographer_username, photographer_first_name,
        photographer_last_name, exif_camera_make, exif_camera_model,
        exif_iso, exif_aperture_value, exif_focal_length, exif_exposure_time,
        photo_location_name, photo_location_latitude, photo_location_longitude,
        photo_location_country, photo_location_city, stats_views,
        stats_downloads, ai_description, ai_primary_landmark_name,
        ai_primary_landmark_latitude, ai_primary_landmark_longitude,
        ai_primary_landmark_confidence, blur_hash
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        photoId, photoUrl, photoImageUrl, submittedAt,
        photoFeatured, width, height, aspectRatio, description,
        photographerUsername, photographerFirstName, photographerLastName,
        exifCameraMake, exifCameraModel, exifIso, exifAperture,
        exifFocalLength, exifExposureTime, locName, locLat, locLon,
        locCountry, locCity, statsViews, statsDownloads, aiDescription,
        aiLandmarkName, aiLandmarkLat, aiLandmarkLon, aiLandmarkConfidence,
        blurHash
      ]
    );

    const colorHex = p.color;
    if (colorHex && colorHex.length === 6) {
      const rgb = hexToRgb(colorHex);
      if (rgb) {
        db.run(
          `INSERT OR IGNORE INTO unsplash_colors (
            photo_id, hex, red, green, blue, keyword, ai_coverage, ai_score
          ) VALUES (?,?,?,?,?,?,?,?)`,
          [photoId, colorHex.toLowerCase(), rgb.r, rgb.g, rgb.b, null, null, null]
        );
      }
    }

    const collections = p.collections ?? [];
    for (const col of collections) {
      if (col.id) {
        db.run(
          `INSERT OR IGNORE INTO unsplash_collections (
            photo_id, collection_id, collection_title, collection_type
          ) VALUES (?,?,?,?)`,
          [photoId, col.id, col.title ?? null, col.type ?? 'public']
        );
      }
    }

    const tags = p.tags ?? [];
    for (const tag of tags) {
      const keyword = tag.title ?? tag.source?.title;
      if (keyword) {
        db.run(
          `INSERT OR IGNORE INTO unsplash_keywords (photo_id, keyword) VALUES (?, ?)`,
          [photoId, keyword]
        );
      }
    }
  }

  async function populateDatabase(db, options = {}) {
    const {
      accessKey,
      pages = 1,
      perPage = 10,
      delayMs = 1000,
    } = options;

    if (!accessKey) throw new Error('Access key required');

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching list page ${page}...`);
      const listPhotos = await fetchPhotosPage(accessKey, page, perPage);
      for (const photo of listPhotos) {
        insertPhoto(db, photo);
      }
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  async function fetchAndUpdatePhotoDetails(db, accessKey, photoId) {
    console.log(`Fetching details for ${photoId}...`);
    const detailData = await fetchPhotoDetails(accessKey, photoId);
    insertPhoto(db, null, detailData);
    return detailData;
  }

  // ------------------------------------------------------------
  //  EXPOSE GLOBALS
  // ------------------------------------------------------------
  window.initUnsplashSchema = initUnsplashSchema;
  window.populateUnsplash = populateDatabase;
  window.fetchAndUpdatePhotoDetails = fetchAndUpdatePhotoDetails;
})();
