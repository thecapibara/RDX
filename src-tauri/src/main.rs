// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Linux (Wayland + Intel Iris Xe / VA-API), WebKitGTK's GStreamer `vah264dec` (rank 257)
    // has a known DMABUF surface pool synchronization bug that causes H.264 frames to jump
    // backward and forward every few seconds. Prioritizing `avdec_h264` (FFmpeg decoder) over
    // `vah264dec` eliminates the frame reordering stutter completely.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("GST_PLUGIN_FEATURE_RANK").is_none() {
            unsafe {
                std::env::set_var(
                    "GST_PLUGIN_FEATURE_RANK",
                    "vah264dec:NONE,vah265dec:NONE,vaav1dec:NONE,qsvh264dec:NONE,msdkh264dec:NONE,avdec_h264:MAX",
                );
            }
        }
    }

    rdx_lib::run();
}
