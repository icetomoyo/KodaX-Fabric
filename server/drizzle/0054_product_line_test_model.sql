ALTER TABLE "product_lines" ADD COLUMN "test_model" varchar(128);--> statement-breakpoint
COMMENT ON COLUMN "product_lines"."test_model" IS '连通性测试优先使用的模型名；空则回退 discoveredModels 或供应商内置默认';