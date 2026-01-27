-- Migration : 001_add_support_columns.sql
-- Ajoute les colonnes et tables nécessaires pour le support / technicien
-- Exécutez ce fichier dans votre base MariaDB/MySQL (par ex. mysql -u user -p assistant < migrations/001_add_support_columns.sql)

-- 1) Étendre l'enum role pour inclure 'technician'
ALTER TABLE `chat_messages`
  MODIFY `role` ENUM('user','assistant','technician') NOT NULL DEFAULT 'user';

-- 2) Ajouter un identifiant d'agent/technicien (optionnel)
ALTER TABLE `chat_messages`
  ADD COLUMN `agent_id` CHAR(36) NULL AFTER `role`;

-- 3) Ajouter un champ JSON pour stocker métadonnées / reason LLM / debug
ALTER TABLE `chat_messages`
  ADD COLUMN `metadata` JSON NULL AFTER `content`;

-- 4) Index utile pour lecture par session + tri
ALTER TABLE `chat_messages`
  ADD INDEX `idx_session_created` (`session_id`, `created_at`);

-- 5) Colonnes pour la table chat_sessions pour indiquer si un technicien est connecté
ALTER TABLE `chat_sessions`
  ADD COLUMN `technician_connected` TINYINT(1) NOT NULL DEFAULT 0 AFTER `last_activity`,
  ADD COLUMN `technician_id` CHAR(36) NULL AFTER `technician_connected`;

-- 6) Table d'audit pour tracer les décisions LLM / connect / disconnect
CREATE TABLE IF NOT EXISTS `chat_audit` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (`session_id`),
  INDEX (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE:
-- - Adaptez les droits et sauvegardez votre base avant d'exécuter la migration.
-- - Si votre version de MariaDB/MySQL ne supporte pas JSON ou l'ajout d'index comme ci-dessus,
--   ajustez les types (par ex. TEXT pour `metadata`) et supprimez/ajustez les index.
