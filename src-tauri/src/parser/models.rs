use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaCard {
    pub id: String,
    pub url: String,
    pub title: String,
    pub poster: String,
    pub entity_type: String,
    pub series_info: Option<String>,
    pub misc_info: String,
    pub rating: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchItem {
    pub title: String,
    pub orig_title: Option<String>,
    pub year: Option<String>,
    pub entity_type: Option<String>,
    pub rating: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Translator {
    pub id: String,
    pub name: String,
    pub language: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonTab {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeTab {
    pub season_id: String,
    pub episode_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamQuality {
    pub label: String,
    pub hls_url: Option<String>,
    pub mp4_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreamData {
    pub qualities: Vec<StreamQuality>,
    pub default_quality: String,
    pub subtitles: Vec<SubtitleTrack>,
    pub thumbnails: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetails {
    pub id: String,
    pub url: String,
    pub title: String,
    pub orig_title: Option<String>,
    pub poster: String,
    pub high_res_poster: Option<String>,
    pub imdb_rating: Option<String>,
    pub kp_rating: Option<String>,
    pub description: String,
    pub info_table: Vec<(String, String)>,
    pub translators: Vec<Translator>,
    pub seasons: Vec<SeasonTab>,
    pub episodes: Vec<EpisodeTab>,
    pub initial_streams: Option<StreamData>,
}
