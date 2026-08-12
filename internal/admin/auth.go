package admin

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type session struct {
	OperatorID int64
	Role       string
	Phone      string
	Name       string
	Expires    time.Time
}

type Sessions struct {
	mu   sync.Mutex
	byID map[string]session
}

func NewSessions() *Sessions {
	return &Sessions{byID: map[string]session{}}
}

func (s *Sessions) Put(opID int64, role, phone, name string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	s.mu.Lock()
	s.byID[tok] = session{OperatorID: opID, Role: role, Phone: phone, Name: name, Expires: time.Now().Add(12 * time.Hour)}
	s.mu.Unlock()
	return tok
}

func (s *Sessions) Get(tok string) (session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, ok := s.byID[tok]
	if !ok || time.Now().After(ss.Expires) {
		return session{}, false
	}
	return ss, true
}

func cookieToken(r *http.Request) string {
	c, err := r.Cookie("th_session")
	if err != nil {
		return r.Header.Get("X-Session")
	}
	return c.Value
}

func setSessionCookie(w http.ResponseWriter, tok string) {
	http.SetCookie(w, &http.Cookie{Name: "th_session", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func checkPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

func hashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}
