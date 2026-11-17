ALTER TABLE "participants" ADD COLUMN "share_publicly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "list_optin" boolean DEFAULT false NOT NULL;