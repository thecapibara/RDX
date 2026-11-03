use base64::{engine::general_purpose::STANDARD, Engine as _};
use regex::Regex;
use crate::parser::models::{StreamData, StreamQuality, SubtitleTrack};

pub struct StreamDeobfuscator;

impl StreamDeobfuscator {
    /// Cleans HTML tags from quality labels (e.g. `<span class="pjs-prem-quality">1080p Ultra</span>` -> `1080p Ultra`)
    pub fn clean_quality_label(raw: &str) -> String {
        let tag_regex = Regex::new(r"<[^>]*>").unwrap();
        tag_regex.replace_all(raw, "").trim().to_string()
    }

    /// Deobfuscates HDRezka `#h` encoded stream string into clear text if obfuscated
    pub fn deobfuscate(raw_stream: &str) -> String {
        let trimmed = raw_stream.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // If it's already a plain Playerjs stream list (e.g. starts with [360p] or contains [360p]http)
        if trimmed.starts_with('[') && trimmed.contains("http") {
            return trimmed.to_string();
        }

        // If it starts with #h or contains //_// trash markers
        let mut cleaned = trimmed;
        if cleaned.starts_with("#h") {
            cleaned = &cleaned[2..];
        } else if cleaned.starts_with('#') {
            cleaned = &cleaned[1..];
        }

        // Strip known HDRezka junk tokens
        let junk_tokens = ["//_//", "bk0", "bk1", "bk2", "bk3", "bk4"];
        let mut stripped = cleaned.to_string();
        for token in &junk_tokens {
            stripped = stripped.replace(token, "");
        }

        // Try Base64 decoding
        let b64_cleaned = stripped.trim();
        // Add padding if missing
        let mut padded = b64_cleaned.to_string();
        while padded.len() % 4 != 0 {
            padded.push('=');
        }

        if let Ok(decoded_bytes) = STANDARD.decode(&padded) {
            if let Ok(decoded_str) = String::from_utf8(decoded_bytes) {
                if decoded_str.contains("http") {
                    return decoded_str;
                }
            }
        }

        // Fallback to original
        trimmed.to_string()
    }

    /// Parses Playerjs quality-stream string `[360p]url1 or url2,[720p]...`
    pub fn parse_stream_string(raw_stream: &str) -> Vec<StreamQuality> {
        let deobfuscated = Self::deobfuscate(raw_stream);
        let mut qualities = Vec::new();

        if deobfuscated.is_empty() {
            return qualities;
        }

        // Format is: [quality1]url1 or url2,[quality2]url3 or url4,...
        // Regex to match `\[(.*?)\]([^\[]+)`
        let re = Regex::new(r"\[(.*?)\]([^\[]+)").unwrap();

        for cap in re.captures_iter(&deobfuscated) {
            let raw_label = cap.get(1).map_or("", |m| m.as_str());
            let urls_str = cap.get(2).map_or("", |m| m.as_str()).trim().trim_end_matches(',');

            let label = Self::clean_quality_label(raw_label);
            let variants: Vec<&str> = urls_str.split(" or ").map(|s| s.trim()).collect();

            let mut hls_url = None;
            let mut mp4_url = None;

            for variant in variants {
                if variant.contains(".m3u8") || variant.contains(":hls:manifest.m3u8") {
                    hls_url = Some(variant.to_string());
                } else if variant.contains(".mp4") {
                    mp4_url = Some(variant.to_string());
                } else if hls_url.is_none() && variant.starts_with("http") {
                    hls_url = Some(variant.to_string());
                }
            }

            if hls_url.is_some() || mp4_url.is_some() {
                qualities.push(StreamQuality {
                    label,
                    hls_url,
                    mp4_url,
                });
            }
        }

        qualities
    }

    /// Parses subtitles string `[En]https://...vtt,[Ru]https://...vtt`
    pub fn parse_subtitles(raw_subtitles: &str) -> Vec<SubtitleTrack> {
        let trimmed = raw_subtitles.trim();
        let mut tracks = Vec::new();

        if trimmed.is_empty() || trimmed == "false" {
            return tracks;
        }

        let re = Regex::new(r"\[(.*?)\](https?://[^\s,]+)").unwrap();
        for cap in re.captures_iter(trimmed) {
            let label = cap.get(1).map_or("", |m| m.as_str()).trim().to_string();
            let url = cap.get(2).map_or("", |m| m.as_str()).trim().to_string();

            if !label.is_empty() && !url.is_empty() {
                tracks.push(SubtitleTrack { label, url });
            }
        }

        tracks
    }

    /// Builds a unified `StreamData` object from raw fields
    pub fn build_stream_data(
        raw_stream: &str,
        default_quality: Option<&str>,
        raw_subtitles: Option<&str>,
        thumbnails: Option<&str>,
    ) -> StreamData {
        let qualities = Self::parse_stream_string(raw_stream);
        let subtitles = raw_subtitles.map(Self::parse_subtitles).unwrap_or_default();

        let default_q = default_quality
            .map(|q| Self::clean_quality_label(q))
            .filter(|q| !q.is_empty())
            .unwrap_or_else(|| {
                qualities
                    .iter()
                    .rev()
                    .find(|q| q.label.contains("1080p") || q.label.contains("720p"))
                    .map(|q| q.label.clone())
                    .unwrap_or_else(|| qualities.first().map(|q| q.label.clone()).unwrap_or_default())
            });

        StreamData {
            qualities,
            default_quality: default_q,
            subtitles,
            thumbnails: thumbnails.map(|s| s.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_quality_label() {
        let raw = r#"<span class="pjs-prem-quality">1080p Ultra</span>"#;
        assert_eq!(StreamDeobfuscator::clean_quality_label(raw), "1080p Ultra");

        let plain = "720p";
        assert_eq!(StreamDeobfuscator::clean_quality_label(plain), "720p");
    }

    #[test]
    fn test_parse_plain_stream_string() {
        let stream_str = r#"[360p]https://stream.voidboost.one/test.mp4:hls:manifest.m3u8 or https://stream.voidboost.one/test.mp4,[720p]https://stream.voidboost.one/720.mp4:hls:manifest.m3u8 or https://stream.voidboost.one/720.mp4,[<span class="pjs-prem-quality">1080p Ultra</span>]https://stream.voidboost.one/1080u.mp4:hls:manifest.m3u8"#;

        let qualities = StreamDeobfuscator::parse_stream_string(stream_str);
        assert_eq!(qualities.len(), 3);

        assert_eq!(qualities[0].label, "360p");
        assert_eq!(
            qualities[0].hls_url.as_deref(),
            Some("https://stream.voidboost.one/test.mp4:hls:manifest.m3u8")
        );
        assert_eq!(
            qualities[0].mp4_url.as_deref(),
            Some("https://stream.voidboost.one/test.mp4")
        );

        assert_eq!(qualities[2].label, "1080p Ultra");
        assert_eq!(
            qualities[2].hls_url.as_deref(),
            Some("https://stream.voidboost.one/1080u.mp4:hls:manifest.m3u8")
        );
        assert_eq!(qualities[2].mp4_url, None);
    }

    #[test]
    fn test_parse_subtitles() {
        let subs_str = "[En]https://subtitles.com/en.vtt,[Ru]https://subtitles.com/ru.vtt";
        let tracks = StreamDeobfuscator::parse_subtitles(subs_str);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].label, "En");
        assert_eq!(tracks[0].url, "https://subtitles.com/en.vtt");
        assert_eq!(tracks[1].label, "Ru");

        assert!(StreamDeobfuscator::parse_subtitles("false").is_empty());
        assert!(StreamDeobfuscator::parse_subtitles("").is_empty());
    }

    #[test]
    fn test_deobfuscate_base64_stream() {
        let original = "[360p]https://stream.com/video.mp4:hls:manifest.m3u8,[720p]https://stream.com/720.mp4";
        let encoded = STANDARD.encode(original);
        // Inject HDRezka junk tokens
        let obfuscated = format!("#h//_//{}bk1{}bk2", &encoded[..10], &encoded[10..]);

        let deobfuscated = StreamDeobfuscator::deobfuscate(&obfuscated);
        assert_eq!(deobfuscated, original);

        let qualities = StreamDeobfuscator::parse_stream_string(&obfuscated);
        assert_eq!(qualities.len(), 2);
        assert_eq!(qualities[0].label, "360p");
    }
}
