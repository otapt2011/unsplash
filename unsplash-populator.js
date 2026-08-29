(() => {
  'use strict';
  
  const BASE_URL = 'https://api.unsplash.com';
  
  // Helper: hex to RGB
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string' || hex.length !== 6) return null;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  
  // Fetch a page of photos from the list endpoint
  async function fetchPhotosPage(accessKey, page, perPage) {
    const url = `${BASE_URL}/photos?page=${page}&per_page=${perPage}`;
    const headers = { Authorization: `Client-ID ${accessKey}` };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`List request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  
  // Fetch full details for a single photo
  async function fetchPhotoDetails(accessKey, photoId) {
    const url = `${BASE_URL}/photos/${photoId}?stats=true&exif=true&collections=public&tags=true`;
    const headers = { Authorization: `Client-ID ${accessKey}` };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Detail request failed for ${photoId}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  
  // Insert a photo using list data (and optionally detail data)
  function insertPhoto(db, photo, detailData = null) {
    const p = detailData || photo; // use detail if available, else list
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
    
    // EXIF (from detail)
    const exif = p.exif ?? {};
    const exifCameraMake = exif.make ?? null;
    const exifCameraModel = exif.model ?? null;
    const exifIso = exif.iso ?? null;
    const exifAperture = exif.aperture ?? null;
    const exifFocalLength = exif.focal_length ?? null;
    const exifExposureTime = exif.exposure_time ?? null;
    
    // Location (from detail)
    const loc = p.location ?? {};
    const locName = loc.name ?? null;
    const locLat = loc.position?.latitude ?? null;
    const locLon = loc.position?.longitude ?? null;
    const locCountry = loc.country ?? null;
    const locCity = loc.city ?? null;
    
    // Stats (from detail's stats object)
    const stats = p.stats ?? {};
    const statsViews = stats.views ?? null;
    const statsDownloads = stats.downloads ?? null;
    
    // AI fields (not standard)
    const aiDescription = p.ai_description ?? null;
    const aiLandmarkName = p.ai_primary_landmark_name ?? null;
    const aiLandmarkLat = p.ai_primary_landmark_latitude ?? null;
    const aiLandmarkLon = p.ai_primary_landmark_longitude ?? null;
    const aiLandmarkConfidence = p.ai_primary_landmark_confidence ?? null;
    
    // Insert or replace into unsplash_photos
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
    
    // Insert dominant color (from list or detail)
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
    
    // Insert collections (if present in detail)
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
    
    // Insert keywords from tags (if present)
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
  
  // Main populate function – only list data, no details
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
        insertPhoto(db, photo); // insert with list data only
      }
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // New function: fetch details for one photo and update DB
  async function fetchAndUpdatePhotoDetails(db, accessKey, photoId) {
    console.log(`Fetching details for ${photoId}...`);
    const detailData = await fetchPhotoDetails(accessKey, photoId);
    insertPhoto(db, null, detailData); // pass detailData as second argument
    return detailData;
  }
  
  // Expose functions globally
  window.populateUnsplash = populateDatabase;
  window.fetchAndUpdatePhotoDetails = fetchAndUpdatePhotoDetails;
})();
