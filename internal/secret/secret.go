package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
)

// HashVK returns the persistent lookup key for a raw virtual key.
func HashVK(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// ParseAESKey accepts 32 raw bytes or 64 hex characters.
func ParseAESKey(raw string) ([]byte, error) {
	if len(raw) == 64 {
		b, err := hex.DecodeString(raw)
		if err != nil {
			return nil, fmt.Errorf("encrypt key hex: %w", err)
		}
		return b, nil
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, fmt.Errorf("CREDENTIAL_ENCRYPT_KEY must be 32 bytes or 64 hex chars")
}

func Encrypt(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(out), nil
}

func Decrypt(key []byte, packed string) (string, error) {
	raw, err := hex.DecodeString(packed)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", fmt.Errorf("ciphertext too short")
	}
	plain, err := gcm.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func MustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
