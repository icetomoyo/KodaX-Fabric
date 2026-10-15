-- 火山方舟的错误码是字符串（AccountQuotaExceeded、RateLimitExceeded.EndpointRPMExceeded），
-- 放宽到与 normalizeErrorCode 的 64 字符上限一致。
ALTER TABLE "upstream_credentials" ALTER COLUMN "last_vendor_code" TYPE varchar(64);
