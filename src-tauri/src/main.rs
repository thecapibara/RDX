// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 1. On Linux, WebKitGTK's GStreamer `vah264dec` (rank 257) has a known DMABUF surface pool
        // synchronization bug that causes H.264 frames to jump backward and forward every few seconds.
        // Prioritizing `avdec_h264` (multi-threaded FFmpeg decoder) eliminates frame reordering stutter
        // and works reliably across Wayland, X11 (LXDE/Lubuntu/XFCE), and older GPUs.
        if std::env::var_os("GST_PLUGIN_FEATURE_RANK").is_none() {
            unsafe {
                std::env::set_var(
                    "GST_PLUGIN_FEATURE_RANK",
                    "vah264dec:NONE,vah265dec:NONE,vaav1dec:NONE,qsvh264dec:NONE,msdkh264dec:NONE,avdec_h264:MAX",
                );
            }
        }

        // 2. Scale Skia GPU painting threads dynamically by CPU core count (1 thread on 2-core Lubuntu/LXDE
        // netbooks to avoid thread contention, up to 4 threads on modern multi-core CPUs).
        if std::env::var_os("WEBKIT_SKIA_GPU_PAINTING_THREADS").is_none() {
            let cores = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(2);
            let skia_threads = (cores / 2).clamp(1, 4);
            unsafe {
                std::env::set_var("WEBKIT_SKIA_GPU_PAINTING_THREADS", skia_threads.to_string());
            }
        }

        // 3. Fallback for older Linux X11 systems / VMs without DRM render nodes (/dev/dri/renderD128):
        // disable DMABUF renderer automatically so WebKitGTK doesn't show a blank window on old GPUs.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
            && !std::path::Path::new("/dev/dri/renderD128").exists()
        {
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    rdx_lib::run();
}
