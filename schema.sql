-- Enable foreign key enforcement (required for ON DELETE CASCADE to work)
PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. CORE PHOTO TABLE
-- ============================================================
CREATE TABLE unsplash_photos (
  photo_id TEXT PRIMARY KEY,
  photo_url TEXT,
  photo_image_url TEXT,
  photo_submitted_at TEXT,               -- ISO 8601 timestamp
  photo_featured INTEGER,                -- 0 = false, 1 = true
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

-- ============================================================
-- 2. KEYWORDS TABLE
-- ============================================================
CREATE TABLE unsplash_keywords (
  photo_id TEXT,
  keyword TEXT,
  ai_service_1_confidence REAL,
  ai_service_2_confidence REAL,
  suggested_by_user INTEGER,             -- 0/1
  user_suggestion_source TEXT,
  suggested_by_ai_service_3 INTEGER,     -- 0/1
  confirmed_by_ai_service_3 INTEGER,     -- 0/1
  PRIMARY KEY (photo_id, keyword),
  FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
);

-- ============================================================
-- 3. COLLECTIONS TABLE
-- ============================================================
CREATE TABLE unsplash_collections (
  photo_id TEXT,
  collection_id TEXT,
  collection_title TEXT,
  photo_collected_at TEXT,               -- ISO 8601
  collection_type TEXT,
  PRIMARY KEY (photo_id, collection_id),
  FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
);

-- ============================================================
-- 4. CONVERSIONS TABLE (event log)
-- ============================================================
CREATE TABLE unsplash_conversions (
  converted_at TEXT,                     -- ISO 8601
  conversion_type TEXT,
  keyword TEXT,
  photo_id TEXT,
  anonymous_user_id TEXT,
  conversion_country TEXT,               -- 2‑letter country code
  device_type TEXT,
  search_orientation_filter TEXT,
  search_ordering TEXT,
  FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
);

-- ============================================================
-- 5. COLORS TABLE
-- ============================================================
CREATE TABLE unsplash_colors (
  photo_id TEXT,
  hex TEXT,                              -- 6‑digit hex without '#'
  red INTEGER,
  green INTEGER,
  blue INTEGER,
  keyword TEXT,
  ai_coverage REAL,
  ai_score REAL,
  PRIMARY KEY (photo_id, hex),
  FOREIGN KEY (photo_id) REFERENCES unsplash_photos(photo_id) ON DELETE CASCADE
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Indexes on unsplash_photos
CREATE INDEX idx_photos_submitted_at ON unsplash_photos(photo_submitted_at);
CREATE INDEX idx_photos_photographer ON unsplash_photos(photographer_username);
CREATE INDEX idx_photos_country ON unsplash_photos(photo_location_country);
CREATE INDEX idx_photos_downloads ON unsplash_photos(stats_downloads);
CREATE INDEX idx_photos_featured ON unsplash_photos(photo_featured);

-- Indexes on child tables
CREATE INDEX idx_keywords_keyword ON unsplash_keywords(keyword);
CREATE INDEX idx_keywords_photo ON unsplash_keywords(photo_id);

CREATE INDEX idx_collections_collection_id ON unsplash_collections(collection_id);
CREATE INDEX idx_collections_photo ON unsplash_collections(photo_id);

CREATE INDEX idx_conversions_photo ON unsplash_conversions(photo_id);
CREATE INDEX idx_conversions_type ON unsplash_conversions(conversion_type);
CREATE INDEX idx_conversions_keyword ON unsplash_conversions(keyword);
CREATE INDEX idx_conversions_time ON unsplash_conversions(converted_at);

CREATE INDEX idx_colors_hex ON unsplash_colors(hex);
CREATE INDEX idx_colors_photo ON unsplash_colors(photo_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- 1. Photos with their keywords
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

-- 2. Photos with their dominant colors
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

-- 3. Photos with their collection memberships
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

-- 4. Aggregated conversion statistics per photo
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

-- 5. Top keywords by number of photos and average AI confidence
CREATE VIEW v_top_keywords AS
SELECT
  keyword,
  COUNT(*) AS photo_count,
  AVG(ai_service_1_confidence) AS avg_conf_service1,
  AVG(ai_service_2_confidence) AS avg_conf_service2
FROM unsplash_keywords
GROUP BY keyword
ORDER BY photo_count DESC;

-- 6. Photos enriched with conversion statistics
CREATE VIEW v_photos_with_stats AS
SELECT
  p.*,
  COALESCE(c.total_conversions, 0) AS total_conversions,
  COALESCE(c.download_count, 0) AS download_count,
  COALESCE(c.unique_users, 0) AS unique_users
FROM unsplash_photos p
LEFT JOIN v_photo_conversion_stats c ON p.photo_id = c.photo_id;

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

-- Audit table to store change history
CREATE TABLE photo_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT,
  action TEXT NOT NULL,                  -- 'INSERT', 'UPDATE', 'DELETE'
  changed_at TEXT DEFAULT (datetime('now')),
  old_data TEXT,                         -- JSON string with old values
  new_data TEXT                          -- JSON string with new values
);

-- Trigger after INSERT on unsplash_photos
CREATE TRIGGER trg_photos_after_insert
AFTER INSERT ON unsplash_photos
BEGIN
  INSERT INTO photo_audit (photo_id, action, new_data)
  VALUES (NEW.photo_id, 'INSERT',
          json_object('photo_url', NEW.photo_url,
                      'photographer_username', NEW.photographer_username,
                      'stats_views', NEW.stats_views,
                      'stats_downloads', NEW.stats_downloads));
END;

-- Trigger after UPDATE on unsplash_photos
CREATE TRIGGER trg_photos_after_update
AFTER UPDATE ON unsplash_photos
BEGIN
  INSERT INTO photo_audit (photo_id, action, old_data, new_data)
  VALUES (NEW.photo_id, 'UPDATE',
          json_object('photo_url', OLD.photo_url,
                      'stats_views', OLD.stats_views,
                      'stats_downloads', OLD.stats_downloads),
          json_object('photo_url', NEW.photo_url,
                      'stats_views', NEW.stats_views,
                      'stats_downloads', NEW.stats_downloads));
END;

-- Trigger after DELETE on unsplash_photos
CREATE TRIGGER trg_photos_after_delete
AFTER DELETE ON unsplash_photos
BEGIN
  INSERT INTO photo_audit (photo_id, action, old_data)
  VALUES (OLD.photo_id, 'DELETE',
          json_object('photo_url', OLD.photo_url,
                      'photographer_username', OLD.photographer_username,
                      'stats_views', OLD.stats_views,
                      'stats_downloads', OLD.stats_downloads));
END;
