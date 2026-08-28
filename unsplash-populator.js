(() => {
  'use strict';
  
  const BASE_URL = 'https://api.unsplash.com';
  
  /**
   * Fetch a page of photos from Unsplash.
   * @param {string} accessKey - Unsplash API access key.
   * @param {number} page - Page number.
   * @param {number} perPage - Photos per page.
   * @returns {Promise<Array>} Array of photo objects.
   */
  async function fetchPhotos(accessKey, page = 1, perPage = 30) {
    const url = `${BASE_URL}/photos`;
    const headers = { Authorization: `Client-ID ${accessKey}` };
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      // Note: 'collections' and 'stats' parameters do NOT add those fields to the list response.
      // They are accepted but ignored by the API for the list endpoint.
    });
    
    const response = await fetch(`${url}?${params}`, { headers });
    if (!response.ok) {
      throw new Error(`Unsplash API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  
  /**
   * Convert a hex color string (e.g., "0c7373") to RGB components.
   * @param {string} hex - Hex color without '#'.
   * @returns {object|null} { r, g, b } or null if invalid.
   */
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string' || hex.length !== 6) return null;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  
  /**
   * Insert a single photo and its dominant color into the database.
   * @param {object} db - Database connection with `run` method.
   * @param {object} photo - Photo object from the list endpoint.
   */
  function insertPhoto(db, photo) {
    // ---------- Extract fields that DO exist in the list response ----------
    const photoId = photo?.id ?? null;
    const photoUrl = photo?.links?.html ?? null;
    const photoImageUrl = photo?.urls?.raw ?? photo?.urls?.full ?? null;
    const submittedAt = photo?.created_at ?? null;
    const width = photo?.width ?? null;
    const height = photo?.height ?? null;
    const aspectRatio = (height && width) ? width / height : null;
    const description = photo?.description ?? photo?.alt_description ?? null;
    const photographerUsername = photo?.user?.username ?? null;
    const photographerFirstName = photo?.user?.first_name ?? null;
    const photographerLastName = photo?.user?.last_name ?? null;
    const blurHash = photo?.blur_hash ?? null;
    
    // Derive "featured" from promoted_at: if not null, photo is promoted (featured)
    const photoFeatured = photo?.promoted_at ? 1 : 0;
    
    // ---------- Fields that are NOT present in list endpoint: set to null ----------
    const exifCameraMake = null;
    const exifCameraModel = null;
    const exifIso = null;
    const exifAperture = null;
    const exifFocalLength = null;
    const exifExposureTime = null;
    const locName = null;
    const locLat = null;
    const locLon = null;
    const locCountry = null;
    const locCity = null;
    const statsViews = null;
    const statsDownloads = null;
    const aiDescription = null;
    const aiLandmarkName = null;
    const aiLandmarkLat = null;
    const aiLandmarkLon = null;
    const aiLandmarkConfidence = null;
    
    // Insert photo record
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
    
    // ---------- Insert dominant color (from the 'color' field) ----------
    const colorHex = photo?.color;
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
    
    // NOTE: The list endpoint does NOT provide tags or collections.
    // If you need keywords/collections, you must fetch each photo individually
    // via `GET /photos/{id}` (which may include tags, collections, exif, location).
    // This script intentionally omits them to avoid excessive API calls.
  }
  
  /**
   * Main function to populate the database.
   * @param {object} db - SQLite database object (must have `run` method).
   * @param {object} options - { accessKey, pages, perPage, delayMs }
   */
  async function populateDatabase(db, options = {}) {
    const {
      accessKey,
      pages = 1,
      perPage = 30,
      delayMs = 1000,
    } = options;
    
    if (!accessKey) {
      throw new Error('Unsplash access key is required. Pass it in options.accessKey.');
    }
    
    console.log(`Starting data collection: ${pages} page(s), ${perPage} photos per page.`);
    
    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching page ${page}...`);
      const photos = await fetchPhotos(accessKey, page, perPage);
      
      for (const photo of photos) {
        insertPhoto(db, photo);
      }
      
      // Optional delay to respect rate limits
      if (delayMs > 0 && page < pages) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    console.log('Data population complete.');
  }
  
  // Export the function (attaches to global object)
  window.populateUnsplash = populateDatabase;
})();
