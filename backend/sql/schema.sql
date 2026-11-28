-- Plesk Shared MySQL / MariaDB Schema (v2.6, all tables prefixed with bono_)

CREATE TABLE IF NOT EXISTS bono_restaurants (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  tin_number VARCHAR(40) DEFAULT '',
  phone VARCHAR(30) DEFAULT '',
  status ENUM('ACTIVE', 'SUSPENDED') DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bono_service_stations (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name_am VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bono_users (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('ADMIN', 'OWNER', 'CASHIER', 'WAITRESS', 'STATION') NOT NULL,
  station_code VARCHAR(40) NULL,
  pin_hash VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bono_menu_items (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_am VARCHAR(120) NOT NULL,
  station_code VARCHAR(40) NOT NULL DEFAULT 'KITCHEN',
  unit_price DECIMAL(10, 2) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bono_allocations (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NOT NULL,
  shift_date VARCHAR(20) NOT NULL,
  waiter_name VARCHAR(100) NOT NULL,
  menu_item_id VARCHAR(36) NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  quantity_issued INT NOT NULL,
  is_extra BOOLEAN DEFAULT FALSE,
  issued_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bono_requests (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NOT NULL,
  shift_date VARCHAR(20) NOT NULL,
  waiter_name VARCHAR(100) NOT NULL,
  menu_item_id VARCHAR(36) NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  quantity_requested INT NOT NULL,
  status ENUM('PENDING', 'APPROVED') DEFAULT 'PENDING',
  created_at_ms BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bono_sales_receipts (
  id VARCHAR(36) PRIMARY KEY,
  restaurant_id VARCHAR(36) NOT NULL,
  shift_date VARCHAR(20) NOT NULL,
  waiter_id VARCHAR(36) NOT NULL,
  waiter_name VARCHAR(100) NOT NULL,
  table_number VARCHAR(30) DEFAULT '',
  turnover_no INT NOT NULL DEFAULT 1,
  menu_item_id VARCHAR(36) NOT NULL,
  item_label VARCHAR(160) NOT NULL,
  order_note VARCHAR(255) DEFAULT '',
  quantity INT NOT NULL DEFAULT 1,
  station_code VARCHAR(40) NOT NULL DEFAULT 'KITCHEN',
  station_status ENUM('PENDING', 'DONE') NOT NULL DEFAULT 'PENDING',
  payment_method ENUM('CASH', 'TELEBIRR', 'CBE_BIRR') DEFAULT 'CASH',
  channel ENUM('APK', 'TELEGRAM', 'WEB') DEFAULT 'WEB',
  unit_price DECIMAL(12, 2) NOT NULL,
  service_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(12, 2) NOT NULL,
  is_settled BOOLEAN DEFAULT FALSE,
  created_at_ms BIGINT NOT NULL,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO bono_restaurants (id, name, tin_number, status) VALUES
  ('rest-1', 'Addis Taste Hotel & Restaurant', '0012345678', 'ACTIVE');

INSERT IGNORE INTO bono_service_stations (id, restaurant_id, code, name_am, name_en) VALUES
  ('st-1', 'rest-1', 'KITCHEN', 'ወጥ ቤት', 'Kitchen'),
  ('st-2', 'rest-1', 'BARISTA', 'ባሪስታ', 'Barista / Bar'),
  ('st-3', 'rest-1', 'COFFEE', 'ቡና ቤት', 'Coffee'),
  ('st-4', 'rest-1', 'SIGA_BET', 'ስጋ ቤት', 'Siga Bet (Butcher)'),
  ('st-5', 'rest-1', 'ROOMS', 'ክፍል / ሆቴል', 'Hotel Rooms');

INSERT IGNORE INTO bono_users (id, restaurant_id, name, role, station_code, pin_hash) VALUES
  ('u-admin-1', NULL, 'Admin', 'ADMIN', NULL, 'bonoaddis_salt_v1:cf1adab81f9c0b8b8be32915c8f4807bcf506617c39b9d548e10ae37abe50096'),
  ('u-owner-1', 'rest-1', 'Owner', 'OWNER', NULL, 'bonoaddis_salt_v1:427f57160668d20e93a73d967032e42941f5d7a224b5bcd4cded585188a1814c'),
  ('u-cashier-1', 'rest-1', 'Cashier', 'CASHIER', NULL, 'bonoaddis_salt_v1:778be82b43a85ac4701c4ec41de26b616199730660f333021a75e43abc43dac9'),
  ('u-waiter-1', 'rest-1', 'ትግስት', 'WAITRESS', NULL, 'bonoaddis_salt_v1:03103cc3e010bb5d57774bed37dd8b6a44a791d5c0c9302e82089d56561b6d71'),
  ('u-st-kitchen', 'rest-1', 'ወጥ ቤት', 'STATION', 'KITCHEN', 'bonoaddis_salt_v1:0942d74b7f09353a54c1d87c2675c36bc348f861f4d5dda41c877ea0ec82984f'),
  ('u-st-barista', 'rest-1', 'ባሪስታ', 'STATION', 'BARISTA', 'bonoaddis_salt_v1:75586458d34aa90e58904d9cf6f259dfe2a984803af4f6daad46fdc813299a1c'),
  ('u-st-coffee', 'rest-1', 'ቡና ቤት', 'STATION', 'COFFEE', 'bonoaddis_salt_v1:433f3a4ae6216f2676137e7365573ec0ed67c8e7bdb08377d232caf3013e582a'),
  ('u-st-siga', 'rest-1', 'ስጋ ቤት', 'STATION', 'SIGA_BET', 'bonoaddis_salt_v1:6014daf91496422286b4fc580d7cd2b01b05add4f583485fb4369774b45ef581'),
  ('u-st-rooms', 'rest-1', 'ክፍል', 'STATION', 'ROOMS', 'bonoaddis_salt_v1:16f2cafd7e17c18bd1af88d856909144097ed06fc6fd929449b4921710a74cc4');

INSERT IGNORE INTO bono_menu_items (id, restaurant_id, name_en, name_am, station_code, unit_price) VALUES
  ('m-1', 'rest-1', 'Special Kitfo', 'ስፔሻል ክትፎ', 'KITCHEN', 650.00),
  ('m-2', 'rest-1', 'Doro Wat', 'ዶሮ ወጥ', 'KITCHEN', 700.00),
  ('m-3', 'rest-1', '1kg Kurt', '1 ኪሎ ቁርጥ', 'SIGA_BET', 1400.00),
  ('m-4', 'rest-1', 'Shekla Tibs', 'ሸክላ ጥብስ', 'SIGA_BET', 850.00),
  ('m-5', 'rest-1', 'Draft Beer', 'ድራፍት ቢራ', 'BARISTA', 120.00),
  ('m-6', 'rest-1', 'Macchiato', 'ማኪያቶ', 'COFFEE', 75.00),
  ('m-7', 'rest-1', 'Standard Room', 'መደበኛ ክፍል', 'ROOMS', 2500.00);
