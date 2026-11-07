package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"
)

func (s *Server) googleConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID: s.GoogleID, ClientSecret: s.GoogleSecret,
		RedirectURL: strings.TrimRight(s.PublicURL, "/") + "/auth/callback/google",
		Scopes:      []string{"openid", "email", "profile"},
		Endpoint:    google.Endpoint,
	}
}

func (s *Server) githubConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID: s.GitHubID, ClientSecret: s.GitHubSecret,
		RedirectURL: strings.TrimRight(s.PublicURL, "/") + "/auth/callback/github",
		Scopes:      []string{"read:user", "user:email"},
		Endpoint:    github.Endpoint,
	}
}

func (s *Server) authConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"google":   s.GoogleID != "" && s.GoogleSecret != "",
		"github":   s.GitHubID != "" && s.GitHubSecret != "",
		"devLogin": s.DevLogin,
	})
}

func (s *Server) startGoogle(w http.ResponseWriter, r *http.Request) {
	if s.GoogleID == "" {
		writeError(w, http.StatusNotImplemented, "Google sign-in is not configured")
		return
	}
	s.beginOAuth(w, r, s.googleConfig())
}

func (s *Server) startGitHub(w http.ResponseWriter, r *http.Request) {
	if s.GitHubID == "" {
		writeError(w, http.StatusNotImplemented, "GitHub sign-in is not configured")
		return
	}
	s.beginOAuth(w, r, s.githubConfig())
}

func (s *Server) beginOAuth(w http.ResponseWriter, r *http.Request, cfg *oauth2.Config) {
	state := randomToken()
	http.SetCookie(w, &http.Cookie{
		Name: "pmd_oauth_state", Value: state, Path: "/", HttpOnly: true,
		MaxAge: 600, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, cfg.AuthCodeURL(state, oauth2.AccessTypeOnline), http.StatusFound)
}

func (s *Server) callbackGoogle(w http.ResponseWriter, r *http.Request) {
	tok, ok := s.finishOAuth(w, r, s.googleConfig())
	if !ok {
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	res, err := s.googleConfig().Client(r.Context(), tok).Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Google did not return a profile")
		return
	}
	defer res.Body.Close()
	var profile struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.NewDecoder(res.Body).Decode(&profile); err != nil || profile.Email == "" {
		writeError(w, http.StatusBadGateway, "Google profile had no email")
		return
	}
	s.finishLogin(w, r, "google", profile.ID, profile.Email, profile.Name, profile.Picture, tok.AccessToken, expiryUnix(tok))
}

func (s *Server) callbackGitHub(w http.ResponseWriter, r *http.Request) {
	tok, ok := s.finishOAuth(w, r, s.githubConfig())
	if !ok {
		return
	}
	client := s.githubConfig().Client(r.Context(), tok)
	res, err := client.Get("https://api.github.com/user")
	if err != nil {
		writeError(w, http.StatusBadGateway, "GitHub did not return a profile")
		return
	}
	defer res.Body.Close()
	var profile struct {
		ID     int64  `json:"id"`
		Email  string `json:"email"`
		Name   string `json:"name"`
		Login  string `json:"login"`
		Avatar string `json:"avatar_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&profile); err != nil {
		writeError(w, http.StatusBadGateway, "GitHub profile was unreadable")
		return
	}
	email := profile.Email
	if email == "" {
		email = s.githubPrimaryEmail(client)
	}
	if email == "" {
		writeError(w, http.StatusBadGateway, "GitHub account has no visible email")
		return
	}
	name := profile.Name
	if name == "" {
		name = profile.Login
	}
	s.finishLogin(w, r, "github", itoa(profile.ID), email, name, profile.Avatar, tok.AccessToken, expiryUnix(tok))
}

func (s *Server) githubPrimaryEmail(client *http.Client) string {
	res, err := client.Get("https://api.github.com/user/emails")
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	var emails []struct {
		Email   string `json:"email"`
		Primary bool   `json:"primary"`
	}
	if err := json.NewDecoder(res.Body).Decode(&emails); err != nil {
		return ""
	}
	for _, e := range emails {
		if e.Primary {
			return e.Email
		}
	}
	if len(emails) > 0 {
		return emails[0].Email
	}
	return ""
}

func (s *Server) finishOAuth(w http.ResponseWriter, r *http.Request, cfg *oauth2.Config) (*oauth2.Token, bool) {
	if errText := r.URL.Query().Get("error"); errText != "" {
		writeError(w, http.StatusBadRequest, errText)
		return nil, false
	}
	stateCookie, err := r.Cookie("pmd_oauth_state")
	if err != nil || stateCookie.Value == "" || stateCookie.Value != r.URL.Query().Get("state") {
		writeError(w, http.StatusBadRequest, "Sign-in expired. Try again.")
		return nil, false
	}
	tok, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "Could not complete sign-in")
		return nil, false
	}
	return tok, true
}

func (s *Server) finishLogin(w http.ResponseWriter, r *http.Request, provider, accountID, email, name, image, access string, exp int64) {
	userID, err := s.Store.UpsertOAuthUser(r.Context(), provider, accountID, accountID, email, name, image, access, exp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save the signed-in account")
		return
	}
	if err := s.setSession(w, r, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not start a session")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *Server) devLogin(w http.ResponseWriter, r *http.Request) {
	if !s.DevLogin {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	var body struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := readJSONLoose(r, &body); err != nil || !strings.Contains(body.Email, "@") {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	name := body.Name
	if name == "" {
		name = strings.Split(body.Email, "@")[0]
	}
	id, err := s.Store.EnsureDevUser(r.Context(), strings.ToLower(body.Email), name)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	if err := s.setSession(w, r, id); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not start a session")
		return
	}
	user, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = s.Store.DeleteSession(r.Context(), c.Value)
	}
	clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	id, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	user, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		mapStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func randomToken() string {
	buf := make([]byte, 18)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func expiryUnix(tok *oauth2.Token) int64 {
	if tok.Expiry.IsZero() {
		return 0
	}
	return tok.Expiry.Unix()
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
