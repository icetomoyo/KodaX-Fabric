package hub

import (
	"time"

	"kodax-fabric/internal/store"
)

// ExpandRotated keeps one routing candidate per logical channel.
// After activation the replacement is preferred; the old secret is only an
// auth fallback during the grace window. After retire_at only the new secret remains.
func ExpandRotated(chs []store.Channel, now time.Time) []store.Channel {
	var out []store.Channel
	for _, c := range chs {
		c.FallbackSecret = ""
		hasNext := c.Replacement != ""
		activated := hasNext && c.ActivateAt != nil && !now.Before(*c.ActivateAt)
		retired := c.RetireAt != nil && !now.Before(*c.RetireAt)
		if !hasNext {
			if retired {
				continue
			}
			out = append(out, c)
			continue
		}
		if !activated {
			out = append(out, c)
			continue
		}
		next := c
		next.Secret = c.Replacement
		next.Replacement = ""
		if !retired {
			next.FallbackSecret = c.Secret
		}
		out = append(out, next)
	}
	return out
}
