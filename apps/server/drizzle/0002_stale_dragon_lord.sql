ALTER TABLE `chats` ADD `status_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `chats` SET `status_at` = `updated_at`;
