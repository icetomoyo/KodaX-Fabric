package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrConflict  = errors.New("conflict")
	ErrInvalid   = errors.New("invalid")
	ErrForbidden = errors.New("forbidden")
)

const (
	RoleAdmin      = "admin"
	RoleDeveloper  = "developer"
	StatusActive   = "active"
	StatusDisabled = "disabled"
)

type Operator struct {
	ID        int64     `json:"id"`
	Phone     string    `json:"phone"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type OperatorCreate struct {
	Phone    string
	Name     string
	Role     string
	Password string
}

type OperatorUpdate struct {
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	Status   *string `json:"status"`
	Password *string `json:"password"`
}

type Overview struct {
	Operators    int `json:"operators"`
	ProviderKeys int `json:"provider_keys"`
	ActiveKeys   int `json:"active_keys"`
	DisabledKeys int `json:"disabled_keys"`
	Pools        int `json:"pools"`
	Channels     int `json:"channels"`
	VirtualKeys  int `json:"virtual_keys"`
	Teams        int `json:"teams"`
	Projects     int `json:"projects"`
}

type TeamView struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type TeamCreate struct {
	Name string `json:"name"`
}

type ProjectView struct {
	ID     int64  `json:"id"`
	TeamID int64  `json:"team_id"`
	Name   string `json:"name"`
}

type ProjectCreate struct {
	TeamID int64  `json:"team_id"`
	Name   string `json:"name"`
}

type ProviderKeyView struct {
	ID           int64  `json:"id"`
	ProviderCode string `json:"provider_code"`
	Status       string `json:"status"`
	TeamID       int64  `json:"team_id"`
}

type ProviderKeyCreate struct {
	ProviderCode string
	Secret       string
	TeamID       int64 `json:"team_id"`
}

type ProviderKeyUpdate struct {
	Status *string `json:"status"`
	TeamID *int64  `json:"team_id"`
}

type PoolView struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	GroupName string `json:"group_name"`
	TeamID    int64  `json:"team_id"`
}

type PoolCreate struct {
	Name      string `json:"name"`
	GroupName string `json:"group_name"`
	TeamID    int64  `json:"team_id"`
}

type PoolUpdate struct {
	Name      *string `json:"name"`
	GroupName *string `json:"group_name"`
	TeamID    *int64  `json:"team_id"`
}

type ChannelView struct {
	ID            int64  `json:"id"`
	PoolID        int64  `json:"pool_id"`
	ProviderKeyID int64  `json:"provider_key_id"`
	Protocol      string `json:"protocol"`
	BaseURL       string `json:"base_url"`
	Status        string `json:"status"`
}

type ChannelCreate struct {
	PoolID        int64  `json:"pool_id"`
	ProviderKeyID int64  `json:"provider_key_id"`
	Protocol      string `json:"protocol"`
	BaseURL       string `json:"base_url"`
}

type ChannelUpdate struct {
	Status  *string `json:"status"`
	BaseURL *string `json:"base_url"`
}

type VirtualKeyView struct {
	ID        int64  `json:"id"`
	PoolID    int64  `json:"pool_id"`
	OwnerID   int64  `json:"owner_id"`
	ProjectID int64  `json:"project_id"`
	Status    string `json:"status"`
	KeyPrefix string `json:"key_prefix"`
	KeyMasked string `json:"key_masked"`
}

type VirtualKeyCreate struct {
	PoolID    int64 `json:"pool_id"`
	OwnerID   int64 `json:"owner_id"`
	ProjectID int64 `json:"project_id"`
}

type VirtualKeyCreated struct {
	VirtualKeyView
	Secret string `json:"secret"`
}

type VirtualKeyUpdate struct {
	Status    *string `json:"status"`
	OwnerID   *int64  `json:"owner_id"`
	PoolID    *int64  `json:"pool_id"`
	ProjectID *int64  `json:"project_id"`
}

// Console is the operator-facing catalog. Relay tests only need Store.
type Console interface {
	AuthenticateOperator(ctx context.Context, phone, password string) (*Operator, error)
	GetOperator(ctx context.Context, id int64) (*Operator, error)
	ListOperators(ctx context.Context) ([]Operator, error)
	CreateOperator(ctx context.Context, in OperatorCreate) (*Operator, error)
	UpdateOperator(ctx context.Context, id int64, in OperatorUpdate) (*Operator, error)

	Overview(ctx context.Context) (*Overview, error)

	ListTeams(ctx context.Context) ([]TeamView, error)
	CreateTeam(ctx context.Context, in TeamCreate) (*TeamView, error)
	ListProjects(ctx context.Context) ([]ProjectView, error)
	CreateProject(ctx context.Context, in ProjectCreate) (*ProjectView, error)
	ListRouteDecisions(ctx context.Context, limit int) ([]RouteDecision, error)

	ListProviderKeys(ctx context.Context) ([]ProviderKeyView, error)
	CreateProviderKey(ctx context.Context, in ProviderKeyCreate) (*ProviderKeyView, error)
	UpdateProviderKey(ctx context.Context, id int64, in ProviderKeyUpdate) (*ProviderKeyView, error)

	ListPools(ctx context.Context) ([]PoolView, error)
	CreatePool(ctx context.Context, in PoolCreate) (*PoolView, error)
	UpdatePool(ctx context.Context, id int64, in PoolUpdate) (*PoolView, error)

	ListChannels(ctx context.Context) ([]ChannelView, error)
	CreateChannel(ctx context.Context, in ChannelCreate) (*ChannelView, error)
	UpdateChannel(ctx context.Context, id int64, in ChannelUpdate) (*ChannelView, error)

	ListVirtualKeys(ctx context.Context, ownerID int64) ([]VirtualKeyView, error)
	CreateVirtualKey(ctx context.Context, in VirtualKeyCreate) (*VirtualKeyCreated, error)
	UpdateVirtualKey(ctx context.Context, id int64, in VirtualKeyUpdate) (*VirtualKeyView, error)
}

func NormalizeRole(role string) (string, error) {
	switch strings.TrimSpace(role) {
	case "", RoleAdmin:
		return RoleAdmin, nil
	case RoleDeveloper:
		return RoleDeveloper, nil
	default:
		return "", ErrInvalid
	}
}

func NormalizeStatus(status string) (string, error) {
	switch strings.TrimSpace(status) {
	case "", StatusActive:
		return StatusActive, nil
	case StatusDisabled:
		return StatusDisabled, nil
	default:
		return "", ErrInvalid
	}
}

func NormalizeGroup(g string) string {
	switch strings.TrimSpace(g) {
	case "premium", "standard", "bulk":
		return g
	case "":
		return "standard"
	default:
		return ""
	}
}

func NormalizeProtocol(p string) (string, error) {
	switch strings.TrimSpace(p) {
	case ProtocolOpenAI, "openai":
		return ProtocolOpenAI, nil
	case ProtocolAnthropic, "anthropic":
		return ProtocolAnthropic, nil
	default:
		return "", ErrInvalid
	}
}

func MaskPrefix(prefix string) string {
	if prefix == "" {
		return "fab-••••"
	}
	return prefix + "••••"
}

func GenerateVK() (raw, prefix string) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	raw = "fab-" + hex.EncodeToString(b[:])
	prefix = raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	return raw, prefix
}
