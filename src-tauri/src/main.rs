// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 1. Disable WebKitGTK Bubblewrap sandbox in AppImage / FUSE mount namespaces.
        // On Arch Linux, Ubuntu 24.04+, and modern kernels, unprivileged user namespaces inside
        // a FUSE-mounted AppImage are blocked, causing WebKitWebProcess to abort with a fatal error.
        // WebKitGTK >= 2.40 requires WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1.
        if std::env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
            }
        }

        // 2. Disable WebKitGTK DMA-BUF hardware renderer ONLY on proprietary NVIDIA drivers.
        // On Intel (Iris Xe/UHD) and AMD Radeon Mesa drivers on Wayland, DMA-BUF zero-copy
        // GPU compositing is essential for fluid 60/120 FPS scrolling without CPU bottlenecking.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            let is_nvidia = std::path::Path::new("/dev/nvidia0").exists()
                || std::path::Path::new("/dev/nvidiactl").exists()
                || std::path::Path::new("/proc/driver/nvidia").exists();
            if is_nvidia {
                unsafe {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
            }
        }

        // 3. On Linux, WebKitGTK's GStreamer `vah264dec` (rank 257) has a known DMABUF surface pool
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

        // 4. Scale Skia GPU painting threads dynamically by CPU core count (1 thread on 2-core Lubuntu/LXDE
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
    }

    rdx_lib::run();
}
