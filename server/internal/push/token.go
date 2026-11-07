package push

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Action is a signed complete or snooze request from a notification.
type Action struct {
	UserID     string
	EntityType string
	EntityID   string
	Action     string
}

type signed struct {
	V              int    `json:"v"`
	UserID         string `json:"userId"`
	SubscriptionID string `json:"subscriptionId,omitempty"`
	EntityType     string `json:"entityType"`
	EntityID       string `json:"entityId"`
	Action         string `json:"action"`
	ExpiresAt      int64  `json:"expiresAt"`
}

// Sign builds a token the existing web app can also verify.
func Sign(secret string, userID, entityType, entityID, action, subscriptionID string, expires time.Time) (string, error) {
	if secret == "" {
		return "", errors.New("push action secret is not configured")
	}
	payload := signed{
		V: 1, UserID: userID, SubscriptionID: subscriptionID,
		EntityType: entityType, EntityID: entityID, Action: action,
		ExpiresAt: expires.UnixMilli(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + sig, nil
}

// Verify accepts the current signed token and the legacy wrapped token.
func Verify(token, secret string) (Action, error) {
	if secret == "" {
		return Action{}, errors.New("push action secret is not configured")
	}
	if strings.Count(token, ".") == 1 {
		return verifyCurrent(token, secret)
	}
	return verifyLegacy(token, secret)
}

func verifyCurrent(token, secret string) (Action, error) {
	encoded, sig, ok := strings.Cut(token, ".")
	if !ok || encoded == "" || sig == "" || strings.Contains(sig, ".") {
		return Action{}, errors.New("malformed token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return Action{}, errors.New("bad signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return Action{}, err
	}
	var payload signed
	if err := json.Unmarshal(raw, &payload); err != nil || payload.V != 1 || payload.UserID == "" || payload.EntityID == "" {
		return Action{}, errors.New("bad payload")
	}
	if payload.ExpiresAt <= time.Now().UnixMilli() {
		return Action{}, errors.New("expired")
	}
	if payload.Action != "complete" && payload.Action != "snooze" {
		return Action{}, errors.New("bad action")
	}
	return Action{UserID: payload.UserID, EntityType: payload.EntityType, EntityID: payload.EntityID, Action: payload.Action}, nil
}

func verifyLegacy(token, secret string) (Action, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return Action{}, err
	}
	var wrap struct {
		P json.RawMessage `json:"p"`
		S string          `json:"s"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil || len(wrap.P) == 0 || wrap.S == "" {
		return Action{}, errors.New("malformed token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(wrap.P)
	expected := mac.Sum(nil)
	got, err := decodeHex(wrap.S)
	if err != nil || !hmac.Equal(expected, got) {
		return Action{}, errors.New("bad signature")
	}
	var body struct {
		EntityType string `json:"entityType"`
		EntityID   string `json:"entityId"`
		UserID     string `json:"userId"`
		Action     string `json:"action"`
		Exp        int64  `json:"exp"`
	}
	if err := json.Unmarshal(wrap.P, &body); err != nil || body.UserID == "" || body.EntityID == "" {
		return Action{}, errors.New("bad payload")
	}
	if body.Exp <= time.Now().UnixMilli() {
		return Action{}, errors.New("expired")
	}
	action := "complete"
	if body.Action == "snooze" || strings.HasPrefix(body.Action, "snooze") {
		action = "snooze"
	}
	if body.EntityType == "" {
		body.EntityType = "task-critical"
	}
	return Action{UserID: body.UserID, EntityType: body.EntityType, EntityID: body.EntityID, Action: action}, nil
}

func decodeHex(s string) ([]byte, error) {
	if len(s)%2 != 0 {
		return nil, errors.New("odd hex")
	}
	out := make([]byte, len(s)/2)
	for i := 0; i < len(out); i++ {
		hi := fromHex(s[i*2])
		lo := fromHex(s[i*2+1])
		if hi < 0 || lo < 0 {
			return nil, errors.New("bad hex")
		}
		out[i] = byte(hi<<4 | lo)
	}
	return out, nil
}

func fromHex(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	default:
		return -1
	}
}

// Send delivers one web push. A 404 or 410 means the subscription is stale.
func Send(endpoint, p256, authKey string, payload []byte, publicKey, privateKey, subject string) error {
	if publicKey == "" || privateKey == "" {
		return errors.New("push is not configured")
	}
	resp, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: endpoint,
		Keys:     webpush.Keys{P256dh: p256, Auth: authKey},
	}, &webpush.Options{
		Subscriber:      subject,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             60,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return staleError{status: resp.StatusCode}
	}
	if resp.StatusCode >= 300 {
		return errors.New("push was rejected")
	}
	return nil
}

type staleError struct{ status int }

func (e staleError) Error() string { return "stale subscription" }

// Stale reports whether the subscription should be deactivated.
func Stale(err error) bool {
	var stale staleError
	return errors.As(err, &stale)
}
