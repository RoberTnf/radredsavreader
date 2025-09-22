function main() {
    const fileInput = document.getElementById('saveFileInput');
    fileInput.addEventListener('change', handleFileSelect);
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const level = document.getElementById('level').value;

    try {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const result = await parse_save(data, level);
        displayResults(result);
    } catch (error) {
        console.error('Error processing save file:', error);
    }
}

function displayResults(result) {
    const outputDiv = document.getElementById('output');
    if (!outputDiv) {
        console.error('No output div found! Please add <div id="output"></div> to your HTML');
        return;
    }

    // Format the import data with line breaks
    const formattedData = result.import_data.replace(/\n/g, '<br>');

    // Create debug info string
    const debugInfo = `
        <div class="debug-info">
            <p>Party Count: ${result.debug_info.party_count}</p>
            <p>Save Index A: ${result.debug_info.save_index_a}</p>
            <p>Save Index B: ${result.debug_info.save_index_b}</p>
        </div>
    `;

    // Update the HTML with copy button and message area
    outputDiv.innerHTML = `
        <div class="output-header mb-4 flex justify-between items-center">
            <h2 class="text-xl font-semibold">Pokemon Data</h2>
            <button id="copyButton" class="copy-btn bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                Copy to Clipboard
            </button>
        </div>
        <div id="copyMessage" class="copy-message hidden mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded"></div>
        <div class="pokemon-data">
            ${formattedData}
        </div>
    `;

    // Add copy button functionality
    const copyButton = document.getElementById('copyButton');
    copyButton.addEventListener('click', () => copyToClipboard(result.import_data));

    // Automatically copy to clipboard
    copyToClipboard(result.import_data, true);
}

function copyToClipboard(text, isAutomatic = false) {
    navigator.clipboard.writeText(text).then(() => {
        showCopyMessage(isAutomatic ? 'Pokemon data automatically copied to clipboard!' : 'Pokemon data copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        showCopyMessage('Failed to copy to clipboard', true);
    });
}

function showCopyMessage(message, isError = false) {
    const messageDiv = document.getElementById('copyMessage');
    if (messageDiv) {
        messageDiv.textContent = message;
        messageDiv.className = `copy-message mb-4 p-3 rounded ${isError ? 'bg-red-100 border border-red-400 text-red-700' : 'bg-green-100 border border-green-400 text-green-700'}`;
        messageDiv.classList.remove('hidden');

        // Hide message after 3 seconds
        setTimeout(() => {
            messageDiv.classList.add('hidden');
        }, 3000);
    }
}

async function parse_save(data, level) {
    const SAVE_INDEX_A_OFFSET = 0xffc;
    const SAVE_BLOCK_B_OFFSET = 0x00E000;
    const SAVE_INDEX_B_OFFSET = SAVE_BLOCK_B_OFFSET + SAVE_INDEX_A_OFFSET;

    // Load move and pokemon data
    const all_moves = await fetch("./ref/moves_rad_red.txt")
        .then(response => response.text())
        .then(text => text.split("\n"));

    const all_mons = await fetch("./ref/mons_rad_red.txt")
        .then(response => response.text())
        .then(text => text.split("\n"));

    const abils = await fetch("./ref/rr_abils.json")
        .then(response => response.json());

    // console.log(all_moves);
    // console.log(all_mons);
    // console.log(abils);

    // Get save indexes from buffer
    const save_index_a = new DataView(data.buffer).getUint16(SAVE_INDEX_A_OFFSET, true);
    const save_index_b = new DataView(data.buffer).getUint16(SAVE_INDEX_B_OFFSET, true);

    let block_offset = 0;
    if (save_index_b > save_index_a && save_index_b !== 65535) {
        block_offset = SAVE_BLOCK_B_OFFSET;
    }

    // Slice save data
    let save = data.slice(block_offset, block_offset + 57343);

    let save_index = Math.max(save_index_a, save_index_b);
    if (save_index_b === 65535) save_index = save_index_a;
    if (save_index_a === 65535) save_index = save_index_b;

    let adjustment = 53248;
    if (save_index_b + save_index_a >= 65535) {
        adjustment = 0;
    }

    const rotation = save_index % 14;
    let total_offset = (rotation * 4096 + adjustment) % 57344;
    let party_offset = (total_offset + 4096 + 0x38) % 57344;
    let party_count = save[party_offset - 4];

    if (party_count === 0) {
        adjustment = 0;
        total_offset = (rotation * 4096 + adjustment) % 57344;
        party_offset = (total_offset + 4096 + 0x38) % 57344;
        party_count = save[party_offset - 4];
    }

    const box_offset = (20480 + 4 + total_offset) % 57344;

    // Combine party and box data
    let box_data = new Uint8Array([
        ...save.slice(party_offset, party_offset + 600),
        ...Array(9).fill().flatMap((_, n) => {
            const box_start = ((n * 4096) + box_offset) % 57344;
            return Array.from(save.slice(box_start, box_start + 4096));
        })
    ]);

    const MAGIC_STRING = new Uint8Array([0x02, 0x02]);
    let mon_count = 0;
    let import_data = "";

    // Parse Pokemon data
    for (let n = 0; n < box_data.length; n += 2) {
        const data = box_data.slice(n, n + 2);
        if (!(data[0] === MAGIC_STRING[0] && data[1] === MAGIC_STRING[1])) continue;

        let showdown_data;
        if (mon_count < party_count) {
            showdown_data = box_data.slice(n + 14, n + 57);
        } else {
            showdown_data = box_data.slice(n + 10, n + 40);
        }

        const pid = new DataView(box_data.buffer).getUint32(n - 18, true);
        const nature = getNature(pid % 25);
        const ability_slot = (pid % 2 === 0) ? 0 : (showdown_data[showdown_data.length - 1] === 191 ? 2 : 1);

        const species_id = new DataView(new Uint8Array(showdown_data.slice(0, 2)).buffer).getUint16(0, true);
        // console.log(species_id);

        if (!all_mons[species_id] || all_mons[species_id] === "-----") {
            continue;
        }

        const ability = abils[all_mons[species_id]]?.[ability_slot] || abils[all_mons[species_id]]?.[0] || "Unknown";

        let moves = [];
        if (mon_count < party_count) {
            for (let i = 0; i < 4; i++) {
                const move_id = new DataView(new Uint8Array(showdown_data.slice(12 + (i * 2), 14 + (i * 2))).buffer).getUint16(0, true);
                moves.push(all_moves[move_id]);
            }
        } else {
            // Convert bytes to binary string, least significant bit first
            const moves_binary = Array.from(showdown_data.slice(-19, -14))
                .map(byte => {
                    // Convert to binary and reverse bits to match Ruby's 'b*' unpacking
                    return byte.toString(2)
                        .padStart(8, '0')
                        .split('')
                        .reverse()
                        .join('');
                })
                .join('');
            moves = parse_moves(moves_binary, all_moves);
        }

        // Build import data string
        import_data += `${all_mons[species_id].trim()}\n`;
        import_data += `Level: ${level}\n`;
        import_data += `${nature} Nature\n`;
        import_data += `Ability: ${ability}\n`;
        moves.forEach(m => import_data += `- ${m}\n`);
        import_data += "\n";

        mon_count++;
        n += 30;
    }

    return {
        import_data,
        debug_info: { party_count, save_index_a, save_index_b }
    };
}

function parse_moves(moves_binary, all_moves) {
    const moves = [];
    for (let n = 0; n < 4; n++) {
        const move_bits = moves_binary.slice(n * 10, (n + 1) * 10).split('').reverse().join('');
        const move_id = parseInt(move_bits, 2);
        moves.push(all_moves[move_id]);
    }
    return moves;
}

function arrayEquals(a, b) {
    return Array.isArray(a) && Array.isArray(b) &&
        a.length === b.length &&
        a.every((val, index) => val === b[index]);
}

function getNature(pid) {
    return ["Hardy",
        "Lonely",
        "Brave",
        "Adamant",
        "Naughty",
        "Bold",
        "Docile",
        "Relaxed",
        "Impish",
        "Lax",
        "Timid",
        "Hasty",
        "Serious",
        "Jolly",
        "Naive",
        "Modest",
        "Mild",
        "Quiet",
        "Bashful",
        "Rash",
        "Calm",
        "Gentle",
        "Sassy",
        "Careful",
        "Quirky"
    ][pid % 25];
}

main();