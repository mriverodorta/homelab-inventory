#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::{cell::RefCell, slice};

    use homelab_domain_core::Engine;
    use homelab_engine_protocol::{
        EngineError, EngineRequest, EngineResponse, EngineSnapshot, PROTOCOL_VERSION, ResponseBody,
    };

    thread_local! {
        static ENGINES: RefCell<Vec<Option<Engine>>> = const { RefCell::new(Vec::new()) };
        static RESULT_LEN: RefCell<u32> = const { RefCell::new(0) };
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_alloc(len: u32) -> u32 {
        let mut bytes = vec![0_u8; len as usize];
        let pointer = bytes.as_mut_ptr();
        std::mem::forget(bytes);
        pointer as u32
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn engine_dealloc(pointer: u32, len: u32) {
        if pointer == 0 || len == 0 {
            return;
        }

        unsafe {
            drop(Vec::from_raw_parts(
                pointer as *mut u8,
                len as usize,
                len as usize,
            ));
        }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn engine_create(pointer: u32, len: u32) -> u32 {
        let snapshot = match unsafe { decode::<EngineSnapshot>(pointer, len) } {
            Ok(snapshot) if snapshot.revision > 0 && !snapshot.project_name.trim().is_empty() => {
                snapshot
            }
            _ => return 0,
        };

        let engine = match Engine::try_from_snapshot(snapshot) {
            Ok(engine) => engine,
            Err(_) => return 0,
        };

        ENGINES.with(|engines| {
            let mut engines = engines.borrow_mut();
            if let Some((index, slot)) = engines
                .iter_mut()
                .enumerate()
                .find(|(_, engine)| engine.is_none())
            {
                *slot = Some(engine);
                return (index + 1) as u32;
            }

            engines.push(Some(engine));
            engines.len() as u32
        })
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn engine_dispatch(handle: u32, pointer: u32, len: u32) -> u32 {
        let request = unsafe { decode::<EngineRequest>(pointer, len) };
        let response = ENGINES.with(|engines| {
            let mut engines = engines.borrow_mut();
            let Some(engine) = handle
                .checked_sub(1)
                .and_then(|index| engines.get_mut(index as usize))
                .and_then(Option::as_mut)
            else {
                return abi_error("invalid-engine-handle", "Engine handle is not active.");
            };

            match request {
                Ok(request) => engine.dispatch(request),
                Err(()) => abi_error("invalid-engine-request", "Engine request is malformed."),
            }
        });

        match rmp_serde::to_vec_named(&response) {
            Ok(bytes) => transfer_result(bytes),
            Err(_) => 0,
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_result_len() -> u32 {
        RESULT_LEN.with(|len| *len.borrow())
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_destroy(handle: u32) -> u32 {
        ENGINES.with(|engines| {
            let mut engines = engines.borrow_mut();
            let Some(slot) = handle
                .checked_sub(1)
                .and_then(|index| engines.get_mut(index as usize))
            else {
                return 0;
            };

            u32::from(slot.take().is_some())
        })
    }

    unsafe fn decode<T>(pointer: u32, len: u32) -> Result<T, ()>
    where
        T: serde::de::DeserializeOwned,
    {
        if pointer == 0 || len == 0 {
            return Err(());
        }

        let bytes = unsafe { slice::from_raw_parts(pointer as *const u8, len as usize) };
        rmp_serde::from_slice(bytes).map_err(|_| ())
    }

    fn transfer_result(mut bytes: Vec<u8>) -> u32 {
        bytes.shrink_to_fit();
        let len = u32::try_from(bytes.len()).unwrap_or(0);
        if len == 0 {
            return 0;
        }

        let pointer = bytes.as_mut_ptr();
        std::mem::forget(bytes);
        RESULT_LEN.with(|result_len| *result_len.borrow_mut() = len);
        pointer as u32
    }

    fn abi_error(code: &str, message: &str) -> EngineResponse {
        EngineResponse {
            protocol_version: PROTOCOL_VERSION,
            request_id: 0,
            base_revision: 0,
            result: ResponseBody::Error(EngineError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}
