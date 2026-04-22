// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

interface RecipientInputProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	required?: boolean;
	autoFocus?: boolean;
}

function parseAddresses(value: string): string[] {
	return value
		.split(/[,;]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export default function RecipientInput({
	label,
	value,
	onChange,
	placeholder,
	required,
	autoFocus,
}: RecipientInputProps) {
	const [chips, setChips] = useState<string[]>(() => parseAddresses(value));
	const [inputVal, setInputVal] = useState("");
	const [focused, setFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const syncingRef = useRef(false);

	// Sync external value → chips (only when value changes from outside)
	useEffect(() => {
		if (syncingRef.current) return;
		const parsed = parseAddresses(value);
		const current = chips.join(",");
		const incoming = parsed.join(",");
		if (current !== incoming) {
			setChips(parsed);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	function commit(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return;
		const next = [...chips, trimmed];
		setChips(next);
		setInputVal("");
		syncingRef.current = true;
		onChange(next.join(", "));
		syncingRef.current = false;
	}

	function removeChip(idx: number) {
		const next = chips.filter((_, i) => i !== idx);
		setChips(next);
		syncingRef.current = true;
		onChange(next.join(", "));
		syncingRef.current = false;
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if ((e.key === "Enter" || e.key === "Tab" || e.key === ",") && inputVal.trim()) {
			e.preventDefault();
			commit(inputVal);
		} else if (e.key === "Backspace" && !inputVal && chips.length > 0) {
			removeChip(chips.length - 1);
		}
	}

	function handleBlur() {
		setFocused(false);
		if (inputVal.trim()) {
			commit(inputVal);
		}
	}

	function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
		const pasted = e.clipboardData.getData("text");
		if (pasted.includes(",") || pasted.includes(";")) {
			e.preventDefault();
			const addresses = parseAddresses(pasted);
			if (addresses.length > 0) {
				const next = [...chips, ...addresses];
				setChips(next);
				syncingRef.current = true;
				onChange(next.join(", "));
				syncingRef.current = false;
			}
		}
	}

	return (
		<div className="flex items-start gap-3 py-2 border-b border-kumo-line last:border-b-0">
			<span className="text-xs font-semibold text-kumo-subtle uppercase tracking-wide w-12 shrink-0 pt-1.5">
				{label}
			</span>
			<div
				className={`flex-1 flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text rounded-md px-2 py-1 transition-colors ${
					focused
						? "ring-1 ring-kumo-brand bg-kumo-base"
						: "bg-transparent hover:bg-kumo-tint/50"
				}`}
				onClick={() => inputRef.current?.focus()}
				onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.focus(); }}
				role="button"
				tabIndex={-1}
			>
				{chips.map((chip, i) => (
					<span
						key={i}
						className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-kumo-fill text-kumo-default text-xs font-medium max-w-[200px]"
					>
						<span className="truncate">{chip}</span>
						<button
							type="button"
							onClick={(e) => { e.stopPropagation(); removeChip(i); }}
							className="shrink-0 text-kumo-subtle hover:text-kumo-default transition-colors bg-transparent border-0 p-0 cursor-pointer leading-none"
							aria-label={`Remove ${chip}`}
						>
							<XIcon size={10} weight="bold" />
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					type="email"
					multiple
					value={inputVal}
					onChange={(e) => setInputVal(e.target.value)}
					onKeyDown={handleKeyDown}
					onFocus={() => setFocused(true)}
					onBlur={handleBlur}
					onPaste={handlePaste}
					placeholder={chips.length === 0 ? placeholder : ""}
					required={required && chips.length === 0}
					autoFocus={autoFocus}
					className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-sm text-kumo-default placeholder:text-kumo-subtle py-0.5"
				/>
			</div>
		</div>
	);
}
