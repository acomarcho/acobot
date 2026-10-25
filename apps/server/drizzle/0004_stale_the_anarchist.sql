CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`text` text NOT NULL,
	`bot_id` text NOT NULL,
	`model` text NOT NULL,
	`access` text NOT NULL,
	`time` text NOT NULL,
	`days` text NOT NULL,
	`on` integer NOT NULL,
	`next_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `automation_id` text REFERENCES automations(id) ON DELETE set null;