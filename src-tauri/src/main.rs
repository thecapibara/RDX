// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 0. Raise soft open-file-descriptor limit (`RLIMIT_NOFILE`) from the default 1024 to 65536.
        // Under `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, WebKitGTK allocates anonymous `memfd` SHM
        // descriptors for 512x512 Skia backing-store tiles alongside HLS/proxy sockets; hitting the
        // 1024 soft limit causes `EMFILE` tile allocation failures (black flickering strips in UI).
        #[repr(C)]
        #[derive(Copy, Clone)]
        struct RLimit {
            rlim_cur: u64,
            rlim_max: u64,
        }
        const RLIMIT_NOFILE: i32 = 7;
        extern "C" {
            fn getrlimit(resource: i32, rlim: *mut RLimit) -> i32;
            fn setrlimit(resource: i32, rlim: *const RLimit) -> i32;
        }
        unsafe {
            let mut rlim = RLimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if getrlimit(RLIMIT_NOFILE, &mut rlim) == 0 && rlim.rlim_cur < 65536 {
                let target = rlim.rlim_max.min(65536).max(rlim.rlim_cur);
                if target > rlim.rlim_cur {
                    rlim.rlim_cur = target;
                    let _ = setrlimit(RLIMIT_NOFILE, &rlim);
                }
            }
        }

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

        // On Linux Wayland (e.g. Intel Iris Xe `i915` + Niri/Mesa + WebKitGTK 2.54), zero-copy
        // GBM/DMABUF leaks `drm-total-system0` (~250 MB/min -> 16+ GB in Shmem/zram), whereas
        // `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` keeps accelerated compositing & smooth threaded
        // scrolling enabled while routing frame transport over SHM with 0 DRM buffer leaks.
        // Also disable GBM pool initialization for DMABUF renderer & WebGL so WebKitWebProcess
        // skips opening `/dev/dri/renderD128` GBM buffer allocations.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            if std::env::var_os("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_none() {
                unsafe {
                    std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
                }
            }
            if std::env::var_os("WEBKIT_DMABUF_RENDERER_DISABLE_GBM").is_none() {
                unsafe {
                    std::env::set_var("WEBKIT_DMABUF_RENDERER_DISABLE_GBM", "1");
                }
            }
            if std::env::var_os("WEBKIT_WEBGL_DISABLE_GBM").is_none() {
                unsafe {
                    std::env::set_var("WEBKIT_WEBGL_DISABLE_GBM", "1");
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

        // Both `WEBKIT_GST_DMABUF_SINK_DISABLED=1` and `WEBKIT_GST_DISABLE_GL_SINK=1` are required:
        // disabling only the DMABUF sink causes WebKitGTK to fall back to `createVideoSinkGL()`
        // (`WebKitGLVideoSink` / `gstglcontext`), which uploads every `avdec_h264` I420 frame into
        // Mesa `i915.gem` YUV textures and leaks cross-context `GstGLMemory` / `EGLImage` BOs
        // (~250 MB/min -> 13+ GB in Shmem/zram). Disabling the GL sink forces WebKitGTK's clean
        // CPU `AppSink` path with zero `gstglcontext` and zero DRM buffer allocations.
        if std::env::var_os("WEBKIT_GST_DMABUF_SINK_DISABLED").is_none() {
            unsafe {
                std::env::set_var("WEBKIT_GST_DMABUF_SINK_DISABLED", "1");
            }
        }
        if std::env::var_os("WEBKIT_GST_DISABLE_GL_SINK").is_none() {
            unsafe {
                std::env::set_var("WEBKIT_GST_DISABLE_GL_SINK", "1");
            }
        }

        // 4. Enable Skia CPU tile rendering to eliminate `SkiaGPUWorker` GL contexts (`GrDirectContext`
        // `i915.gem` caches) and redundant CPU->GPU->CPU tile round-trips under SHM frame transport.
        if std::env::var_os("WEBKIT_SKIA_ENABLE_CPU_RENDERING").is_none() {
            unsafe {
                std::env::set_var("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1");
            }
        }
        if std::env::var_os("WEBKIT_SKIA_CPU_PAINTING_THREADS").is_none() {
            let cores = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(2);
            let skia_threads = (cores / 2).clamp(1, 2);
            unsafe {
                std::env::set_var("WEBKIT_SKIA_CPU_PAINTING_THREADS", skia_threads.to_string());
            }
        }
    }

    rdx_lib::run();
}
