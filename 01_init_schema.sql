-- 01_init_schema.sql
-- -------------------------------------------------
-- Create the database for the offline TODA system
-- -------------------------------------------------
DROP DATABASE IF EXISTS toda;
CREATE DATABASE toda CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE toda;

-- -------------------------------------------------
-- Table: toda_admin (single‑record login store)
-- -------------------------------------------------
CREATE TABLE toda_admin (
    admin_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username      VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (admin_id),
    UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO toda_admin (username, password_hash) VALUES
('toda_president', '$2b$10$BL1Wc4rQu8WiqWMX1.dkwu5buBd.1KE1F/sfjlEwWt6l7AW1GC3V'); 
-- -------------------------------------------------
-- Table: tricycle_units (soft‑delete via archived_at)
-- -------------------------------------------------
CREATE TABLE tricycle_units (
    unit_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    driver_name   VARCHAR(100) NOT NULL,
    body_number   VARCHAR(20)  NOT NULL,
    plate_number  VARCHAR(20)  NOT NULL,
    status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    archived_at   DATETIME     NULL,
    PRIMARY KEY (unit_id),
    -- Enforce absolute uniqueness for the two identifiers
    UNIQUE KEY uq_body_number (body_number),
    UNIQUE KEY uq_plate_number (plate_number),
    -- Prevent empty strings (MySQL 8.0+ check constraint)
    CONSTRAINT chk_body_not_empty  CHECK (TRIM(body_number) <> ''),
    CONSTRAINT chk_plate_not_empty CHECK (TRIM(plate_number) <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- Table: tricycle_complaints (idempotent via external_row_hash)
-- -------------------------------------------------
CREATE TABLE tricycle_complaints (
    complaint_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    external_row_hash     CHAR(64)     NOT NULL,   -- SHA‑256 hex string
    passenger_date_submitted DATETIME NOT NULL,
    target_body_number    VARCHAR(20)  NOT NULL,
    complaint_summary     TEXT        NOT NULL,   -- verbatim passenger input
    status                ENUM('PENDING','RESOLVED') NOT NULL DEFAULT 'PENDING',
    resolved_at           DATETIME     NULL,
    imported_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (complaint_id),
    UNIQUE KEY uq_external_row_hash (external_row_hash),
    INDEX idx_status (status),
    INDEX idx_date_submitted (passenger_date_submitted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- Table: fare_settings (single‑row config)
-- -------------------------------------------------
CREATE TABLE fare_settings (
    setting_id    INT UNSIGNED NOT NULL,  -- Removed AUTO_INCREMENT to satisfy MySQL rules
    minimum_fare  DECIMAL(10,2) NULL,   
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_id),
    -- Ensure only one row can ever exist
    CONSTRAINT chkr_one_row CHECK (setting_id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert the singleton row (id = 1) if it does not exist.
INSERT INTO fare_settings (setting_id, minimum_fare)
SELECT 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM fare_settings WHERE setting_id = 1);