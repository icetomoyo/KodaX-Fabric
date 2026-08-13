package hub

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func OpenRedis(url string) (*redis.Client, error) {
	if url == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	c := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		_ = c.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return c, nil
}

type RedisPinger struct{ C *redis.Client }

func (p RedisPinger) Ping(ctx context.Context) error {
	if p.C == nil {
		return fmt.Errorf("redis not configured")
	}
	return p.C.Ping(ctx).Err()
}
