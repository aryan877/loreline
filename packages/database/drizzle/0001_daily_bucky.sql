CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_user_parent_idx" ON "folders" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_user_parent_name_idx" ON "folders" USING btree ("user_id","parent_id","name");--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_user_folder_idx" ON "books" USING btree ("user_id","folder_id");