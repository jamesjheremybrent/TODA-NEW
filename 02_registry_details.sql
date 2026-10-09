USE toda;

ALTER TABLE tricycle_units
  ADD COLUMN phone VARCHAR(30) NULL AFTER status,
  ADD COLUMN address TEXT NULL AFTER phone,
  ADD COLUMN license_number VARCHAR(50) NULL AFTER address,
  ADD COLUMN member_since DATE NULL AFTER license_number,
  ADD COLUMN photo_data LONGTEXT NULL AFTER member_since;
