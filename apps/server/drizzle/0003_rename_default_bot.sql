-- The default bot was named acobot, like the app. It is the general agent now. Only what the user did not change is renamed.
UPDATE `bots` SET `name` = 'general agent' WHERE `id` = 'acobot' AND `name` = 'acobot';--> statement-breakpoint
UPDATE `bots` SET `prompt` = replace(`prompt`, 'You are acobot, a helper that lives on the user''s own computer and can use all of it through your tools.', 'You are the general agent in acobot, an app on the user''s own computer.' || char(10) || 'Through your tools you can use all of that computer.') WHERE `id` = 'acobot';
