import { defineSemanticTokens, defineTokens } from "@pandacss/dev"

export const colors = defineTokens.colors({})

export const semanticColors = defineSemanticTokens.colors({
  background: {
    app: {
      value: {
        _dark: "#0e0e0e",
        base: "#ffffff",
      },
    },
    contrast: {
      value: {
        _dark: "#222222",
        base: "#f0f0f0",
      },
    },
    muted: {
      value: {
        _dark: "#e8e8e808",
        base: "#0a121708",
      },
    },
    mutedNoAlpha: {
      value: {
        _dark: "#2C2F3A",
        base: "rgba(251, 251, 251, 1)",
      },
    },
    popover: {
      value: {
        _dark: "#131314",
        base: "#ffffff",
      },
    },
    secondary: {
      value: {
        _dark: "#1e1f20",
        base: "#f9f9f9",
      },
    },
    sidebar: {
      value: {
        _dark: "#09090a",
        base: "#f9f9f9",
      },
    },
    /** The dark chip that floats over a selected cell, in either theme. */
    toolbar: {
      value: {
        _dark: "#222222",
        base: "#000000",
      },
    },
    toolbarHover: {
      value: {
        _dark: "#333333",
        base: "#2c2d33",
      },
    },
  },
  border: {
    focused: {
      value: {
        _dark: "#e8e8e8",
        base: "#0a1217",
      },
    },
    subtle: { value: { _dark: "#e8e8e80a", base: "#0a12170a" } },
    toolbar: { value: { _dark: "#e8e8e826", base: "#fcfcfd40" } },
    success: { value: "{colors.palette.green.4}" },
  },
  brand: {
    error: {
      1: {
        value: {
          _dark: "#f4121209",
          base: "#ff000003",
        },
      },
      2: {
        value: {
          _dark: "#f22f3e11",
          base: "#ff000008",
        },
      },
      3: {
        value: {
          _dark: "#ff173f2d",
          base: "#f3000d14",
        },
      },
      4: {
        value: {
          _dark: "#fe0a3b44",
          base: "#ff000824",
        },
      },
      5: {
        value: {
          _dark: "#ff204756",
          base: "#ff000632",
        },
      },
      6: {
        value: {
          _dark: "#ff3e5668",
          base: "#f8000442",
        },
      },
      7: {
        value: {
          _dark: "#ff536184",
          base: "#df000356",
        },
      },
      8: {
        value: {
          _dark: "#ff5d61b0",
          base: "#d2000571",
        },
      },
      9: {
        value: {
          _dark: "#fe4e54e4",
          base: "#db0007b7",
        },
      },
      10: {
        value: {
          _dark: "#ff6465eb",
          base: "#d10005c1",
        },
      },
      11: {
        value: {
          _dark: "#ff9592",
          base: "#c40006d3",
        },
      },
      12: {
        value: {
          _dark: "#ffd1d9",
          base: "#55000de8",
        },
      },
      DEFAULT: {
        value: {
          _dark: "#fe4e54e4",
          base: "#db0007b7",
        },
      },
    },
    info: {
      1: {
        value: {
          _dark: "#004df211",
          base: "#0080ff04",
        },
      },
      2: {
        value: {
          _dark: "#1166fb18",
          base: "#008cff0b",
        },
      },
      3: {
        value: {
          _dark: "#0077ff3a",
          base: "#008ff519",
        },
      },
      4: {
        value: {
          _dark: "#0075ff57",
          base: "#009eff2a",
        },
      },
      5: {
        value: {
          _dark: "#0081fd6b",
          base: "#0093ff3d",
        },
      },
      6: {
        value: {
          _dark: "#0f89fd7f",
          base: "#0088f653",
        },
      },
      7: {
        value: {
          _dark: "#2a91fe98",
          base: "#0083eb71",
        },
      },
      8: {
        value: {
          _dark: "#3094feb9",
          base: "#0084e6a1",
        },
      },
      9: {
        value: {
          _dark: "#0090ff",
          base: "#0090ff",
        },
      },
      10: {
        value: {
          _dark: "#3b9eff",
          base: "#0086f0fa",
        },
      },
      11: {
        value: {
          _dark: "#70b8ff",
          base: "#006dcbf2",
        },
      },
      12: {
        value: {
          _dark: "#c2e6ff",
          base: "#002359ee",
        },
      },
      DEFAULT: {
        value: {
          _dark: "#0090ff",
          base: "#0090ff",
        },
      },
    },
    panel: {
      0: { value: { _dark: "#e8e8e800", base: "#0a121700" } },
      1: { value: { _dark: "#e8e8e803", base: "#0a121703" } },
      2: { value: { _dark: "#e8e8e805", base: "#0a121705" } },
      3: { value: { _dark: "#e8e8e808", base: "#0a121708" } },
      4: { value: { _dark: "#e8e8e80a", base: "#0a12170a" } },
      5: { value: { _dark: "#e8e8e80d", base: "#0a12170d" } },
      6: { value: { _dark: "#e8e8e80f", base: "#0a12170f" } },
      7: { value: { _dark: "#e8e8e812", base: "#0a121712" } },
      8: { value: { _dark: "#e8e8e814", base: "#0a121714" } },
      9: { value: { _dark: "#e8e8e817", base: "#0a121717" } },
      10: { value: { _dark: "#e8e8e81a", base: "#0a12171a" } },
      15: { value: { _dark: "#e8e8e826", base: "#0a121726" } },
      20: { value: { _dark: "#e8e8e833", base: "#0a121733" } },
      25: { value: { _dark: "#e8e8e840", base: "#0a121740" } },
      30: { value: { _dark: "#e8e8e84d", base: "#0a12174d" } },
      35: { value: { _dark: "#e8e8e859", base: "#0a121759" } },
      40: { value: { _dark: "#e8e8e866", base: "#0a121766" } },
      45: { value: { _dark: "#e8e8e873", base: "#0a121773" } },
      50: { value: { _dark: "#e8e8e880", base: "#0a121780" } },
      55: { value: { _dark: "#e8e8e88c", base: "#0a12178c" } },
      60: { value: { _dark: "#e8e8e899", base: "#0a121799" } },
      65: { value: { _dark: "#e8e8e8a6", base: "#0a1217a6" } },
      70: { value: { _dark: "#e8e8e8b3", base: "#0a1217b3" } },
      75: { value: { _dark: "#e8e8e8bf", base: "#0a1217bf" } },
      80: { value: { _dark: "#e8e8e8cc", base: "#0a1217cc" } },
      85: { value: { _dark: "#e8e8e8d9", base: "#0a1217d9" } },
      90: { value: { _dark: "#e8e8e8e6", base: "#0a1217e6" } },
      95: { value: { _dark: "#e8e8e8f2", base: "#0a1217f2" } },
      accent: { value: { _dark: "#e8e8e8", base: "#0a1217" } },
      muted: { value: { _dark: "#e8e8e866", base: "#0a121766" } },
      mutedSolid: { value: { _dark: "#5d5d5d", base: "#666e74" } },
    },
    primary: {
      1: {
        value: {
          _dark: "#000000",
          base: "#fcfcfd",
        },
      },
      2: {
        value: {
          _dark: "#121315",
          base: "#f9f9fb",
        },
      },
      3: {
        value: {
          _dark: "#1f1f22",
          base: "#eff0f3",
        },
      },
      4: {
        value: {
          _dark: "#27282c",
          base: "#e7e8ec",
        },
      },
      5: {
        value: {
          _dark: "#2f3035",
          base: "#e0e1e6",
        },
      },
      6: {
        value: {
          _dark: "#393a3f",
          base: "#d8d9e0",
        },
      },
      7: {
        value: {
          _dark: "#46474e",
          base: "#cdced7",
        },
      },
      8: {
        value: {
          _dark: "#5e606a",
          base: "#b9bbc6",
        },
      },
      9: {
        value: {
          _dark: "#ffffff",
          base: "#000000",
        },
      },
      10: {
        value: {
          _dark: "#f5f6f8",
          base: "#2c2d33",
        },
      },
      11: {
        value: {
          _dark: "#b2b3bd",
          base: "#62636c",
        },
      },
      12: {
        value: {
          _dark: "#eeeef0",
          base: "#1e1f24",
        },
      },
    },
    secondary: { value: { _dark: "#e8e8e899", base: "#0a121799" } },
    secondarySolid: { value: { _dark: "#8b8b8b", base: "#686d70" } },
    success: {
      1: { value: "{colors.palette.green.1}" },
      2: { value: "{colors.palette.green.2}" },
      3: { value: "{colors.palette.green.3}" },
      4: { value: "{colors.palette.green.4}" },
      5: { value: "{colors.palette.green.5}" },
      6: { value: "{colors.palette.green.6}" },
      7: { value: "{colors.palette.green.7}" },
      8: { value: "{colors.palette.green.8}" },
      9: { value: "{colors.palette.green.9}" },
      10: { value: "{colors.palette.green.10}" },
      11: { value: "{colors.palette.green.11}" },
      12: { value: "{colors.palette.green.12}" },
      DEFAULT: { value: "{colors.palette.green.9}" },
    },
    warning: {
      1: {
        value: {
          _dark: "#e63c0006",
          base: "#c0800004",
        },
      },
      2: {
        value: {
          _dark: "#fd9b000d",
          base: "#f4d10016",
        },
      },
      3: {
        value: {
          _dark: "#fa820022",
          base: "#ffde003d",
        },
      },
      4: {
        value: {
          _dark: "#fc820032",
          base: "#ffd40063",
        },
      },
      5: {
        value: {
          _dark: "#fd8b0041",
          base: "#f8cf0088",
        },
      },
      6: {
        value: {
          _dark: "#fd9b0051",
          base: "#eab5008c",
        },
      },
      7: {
        value: {
          _dark: "#ffab2567",
          base: "#dc9b009d",
        },
      },
      8: {
        value: {
          _dark: "#ffae3587",
          base: "#da8a00c9",
        },
      },
      9: {
        value: {
          _dark: "#ffc53d",
          base: "#ffb300c2",
        },
      },
      10: {
        value: {
          _dark: "#ffd60a",
          base: "#ffb300e7",
        },
      },
      11: {
        value: {
          _dark: "#ffca16",
          base: "#ab6400",
        },
      },
      12: {
        value: {
          _dark: "#ffe7b3",
          base: "#341500dd",
        },
      },
      DEFAULT: {
        value: {
          _dark: "#ffc53d",
          base: "#ffb300c2",
        },
      },
    },
  },
  palette: {
    amber: {
      1: { value: { _dark: "#e63c0006", base: "#c0800004" } },
      2: { value: { _dark: "#fd9b000d", base: "#f4d10016" } },
      3: { value: { _dark: "#fa820022", base: "#ffde003d" } },
      4: { value: { _dark: "#fc820032", base: "#ffd40063" } },
      5: { value: { _dark: "#fd8b0041", base: "#f8cf0088" } },
      6: { value: { _dark: "#fd9b0051", base: "#eab5008c" } },
      7: { value: { _dark: "#ffab2567", base: "#dc9b009d" } },
      8: { value: { _dark: "#ffae3587", base: "#da8a00c9" } },
      9: { value: { _dark: "#ffc53d", base: "#ffb300c2" } },
      10: { value: { _dark: "#ffd60a", base: "#ffb300e7" } },
      11: { value: { _dark: "#ffca16", base: "#ab6400" } },
      12: { value: { _dark: "#ffe7b3", base: "#341500dd" } },
    },
    blue: {
      1: { value: { _dark: "#004df211", base: "#0080ff04" } },
      2: { value: { _dark: "#1166fb18", base: "#008cff0b" } },
      3: { value: { _dark: "#0077ff3a", base: "#008ff519" } },
      4: { value: { _dark: "#0075ff57", base: "#009eff2a" } },
      5: { value: { _dark: "#0081fd6b", base: "#0093ff3d" } },
      6: { value: { _dark: "#0f89fd7f", base: "#0088f653" } },
      7: { value: { _dark: "#2a91fe98", base: "#0083eb71" } },
      8: { value: { _dark: "#3094feb9", base: "#0084e6a1" } },
      9: { value: { _dark: "#0090ff", base: "#0090ff" } },
      10: { value: { _dark: "#3b9eff", base: "#0086f0fa" } },
      11: { value: { _dark: "#70b8ff", base: "#006dcbf2" } },
      12: { value: { _dark: "#c2e6ff", base: "#002359ee" } },
    },
    bronze: {
      1: { value: { _dark: "#d1110004", base: "#55000003" } },
      2: { value: { _dark: "#fbbc910c", base: "#cc33000a" } },
      3: { value: { _dark: "#faceb817", base: "#92250015" } },
      4: { value: { _dark: "#facdb622", base: "#80280020" } },
      5: { value: { _dark: "#ffd2c12d", base: "#7423002c" } },
      6: { value: { _dark: "#ffd1c03c", base: "#7324003a" } },
      7: { value: { _dark: "#fdd0c04f", base: "#6c1f004c" } },
      8: { value: { _dark: "#ffd6c565", base: "#671c0066" } },
      9: { value: { _dark: "#fec7b09b", base: "#551a008d" } },
      10: { value: { _dark: "#fecab5a9", base: "#4c150097" } },
      11: { value: { _dark: "#ffd7c6d1", base: "#3d0f00ab" } },
      12: { value: { _dark: "#fff1e9ec", base: "#1d0600d4" } },
    },
    brown: {
      1: { value: { _dark: "#91110002", base: "#aa550003" } },
      2: { value: { _dark: "#fba67c0c", base: "#aa550009" } },
      3: { value: { _dark: "#fcb58c19", base: "#a04b0018" } },
      4: { value: { _dark: "#fbbb8a24", base: "#9b4a0026" } },
      5: { value: { _dark: "#fcb88931", base: "#9f4d0035" } },
      6: { value: { _dark: "#fdba8741", base: "#a04e0048" } },
      7: { value: { _dark: "#ffbb8856", base: "#a34e0060" } },
      8: { value: { _dark: "#ffbe8773", base: "#9f4a0081" } },
      9: { value: { _dark: "#feb87da8", base: "#823c00a7" } },
      10: { value: { _dark: "#ffc18cb3", base: "#723300ac" } },
      11: { value: { _dark: "#fed1aad9", base: "#522100b9" } },
      12: { value: { _dark: "#feecd4f2", base: "#140600d1" } },
    },
    crimson: {
      1: { value: { _dark: "#f4126709", base: "#ff005503" } },
      2: { value: { _dark: "#f22f7a11", base: "#e0004008" } },
      3: { value: { _dark: "#fe2a8b2a", base: "#ff005216" } },
      4: { value: { _dark: "#fd158741", base: "#f8005123" } },
      5: { value: { _dark: "#fd278f51", base: "#e5004f31" } },
      6: { value: { _dark: "#fe459763", base: "#d0004b41" } },
      7: { value: { _dark: "#fd559b7f", base: "#bf004753" } },
      8: { value: { _dark: "#fe5b9bab", base: "#b6004a6c" } },
      9: { value: { _dark: "#fe418de8", base: "#e2005bc2" } },
      10: { value: { _dark: "#ff5693ed", base: "#d70056cb" } },
      11: { value: { _dark: "#ff92ad", base: "#c4004fe2" } },
      12: { value: { _dark: "#ffd5eafd", base: "#530026e9" } },
    },
    cyan: {
      1: { value: { _dark: "#0091f70a", base: "#0099cc05" } },
      2: { value: { _dark: "#02a7f211", base: "#009db10d" } },
      3: { value: { _dark: "#00befd28", base: "#00c2d121" } },
      4: { value: { _dark: "#00baff3b", base: "#00bcd435" } },
      5: { value: { _dark: "#00befd4d", base: "#01b4cc4a" } },
      6: { value: { _dark: "#00c7fd5e", base: "#00a7c162" } },
      7: { value: { _dark: "#14cdff75", base: "#009fbb82" } },
      8: { value: { _dark: "#11cfff95", base: "#00a3c0c2" } },
      9: { value: { _dark: "#00cfffc3", base: "#00a2c7" } },
      10: { value: { _dark: "#28d6ffcd", base: "#0094b7f8" } },
      11: { value: { _dark: "#52e1fee5", base: "#007491ef" } },
      12: { value: { _dark: "#bbf3fef7", base: "#00323ef2" } },
    },
    gold: {
      1: { value: { _dark: "#91911102", base: "#55550003" } },
      2: { value: { _dark: "#f9e29d0b", base: "#9d8a000d" } },
      3: { value: { _dark: "#f8ecbb15", base: "#75600018" } },
      4: { value: { _dark: "#ffeec41e", base: "#6b4e0024" } },
      5: { value: { _dark: "#feecc22a", base: "#60460030" } },
      6: { value: { _dark: "#feebcb37", base: "#64440040" } },
      7: { value: { _dark: "#ffedcd48", base: "#63420055" } },
      8: { value: { _dark: "#fdeaca5f", base: "#633d0072" } },
      9: { value: { _dark: "#ffdba690", base: "#5333009a" } },
      10: { value: { _dark: "#fedfb09d", base: "#492d00a1" } },
      11: { value: { _dark: "#fee7c6c8", base: "#362100b4" } },
      12: { value: { _dark: "#fef7ede7", base: "#130c00d4" } },
    },
    grass: {
      1: { value: { _dark: "#00de1205", base: "#00c00004" } },
      2: { value: { _dark: "#5ef7780a", base: "#0099000a" } },
      3: { value: { _dark: "#70fe8c1b", base: "#00970016" } },
      4: { value: { _dark: "#57ff802c", base: "#009f0725" } },
      5: { value: { _dark: "#68ff8b3b", base: "#00930536" } },
      6: { value: { _dark: "#71ff8f4b", base: "#008f0a4d" } },
      7: { value: { _dark: "#77fd925d", base: "#018b0f6b" } },
      8: { value: { _dark: "#77fd9070", base: "#008d199a" } },
      9: { value: { _dark: "#65ff82a1", base: "#008619b9" } },
      10: { value: { _dark: "#72ff8dae", base: "#007b17c1" } },
      11: { value: { _dark: "#89ff9fcd", base: "#006514d5" } },
      12: { value: { _dark: "#ceffceef", base: "#002006df" } },
    },
    gray: {
      1: { value: { _dark: "#00000000", base: "#00000003" } },
      2: { value: { _dark: "#ffffff09", base: "#00000006" } },
      3: { value: { _dark: "#ffffff12", base: "#0000000f" } },
      4: { value: { _dark: "#ffffff1b", base: "#00000017" } },
      5: { value: { _dark: "#ffffff22", base: "#0000001f" } },
      6: { value: { _dark: "#ffffff2c", base: "#00000026" } },
      7: { value: { _dark: "#ffffff3b", base: "#00000031" } },
      8: { value: { _dark: "#ffffff55", base: "#00000044" } },
      9: { value: { _dark: "#ffffff64", base: "#00000072" } },
      10: { value: { _dark: "#ffffff72", base: "#0000007c" } },
      11: { value: { _dark: "#ffffffaf", base: "#0000009b" } },
      12: { value: { _dark: "#ffffffed", base: "#000000df" } },
    },
    green: {
      1: { value: { _dark: "#00bb0003", base: "#00ff2b06" } },
      2: { value: { _dark: "#29f9400b", base: "#00c0000c" } },
      3: { value: { _dark: "#35ff4f1d", base: "#00d4121d" } },
      4: { value: { _dark: "#11fb482f", base: "#00ca1630" } },
      5: { value: { _dark: "#26fc563f", base: "#00c61647" } },
      6: { value: { _dark: "#35fd624f", base: "#00c01a64" } },
      7: { value: { _dark: "#3dfd6761", base: "#00ba208f" } },
      8: { value: { _dark: "#3dff6d75", base: "#00c54c" } },
      9: { value: { _dark: "#00fe62c6", base: "#00c950" } },
      10: { value: { _dark: "#19fe65b7", base: "#00bd44" } },
      11: { value: { _dark: "#35fe6fd8", base: "#00851a" } },
      12: { value: { _dark: "#b4febdf5", base: "#003910f6" } },
    },
    indigo: {
      1: { value: { _dark: "#0000fe0e", base: "#0000ff02" } },
      2: { value: { _dark: "#2539fd1a", base: "#0020ff08" } },
      3: { value: { _dark: "#3d44fe46", base: "#002dff11" } },
      4: { value: { _dark: "#4440ff69", base: "#0035ff1d" } },
      5: { value: { _dark: "#4c4afd7d", base: "#0130ff2b" } },
      6: { value: { _dark: "#5757fe8e", base: "#002fff3c" } },
      7: { value: { _dark: "#5f62ffa5", base: "#0026ff51" } },
      8: { value: { _dark: "#6263fec7", base: "#001cff6e" } },
      9: { value: { _dark: "#615fff", base: "#0300ffa0" } },
      10: { value: { _dark: "#676cffd2", base: "#0500dbab" } },
      11: { value: { _dark: "#a1adff", base: "#0600cfb4" } },
      12: { value: { _dark: "#d8e0ff", base: "#000052da" } },
    },
    iris: {
      1: { value: { _dark: "#3636fe0e", base: "#0000ff02" } },
      2: { value: { _dark: "#564bf916", base: "#0000ff07" } },
      3: { value: { _dark: "#525bff3b", base: "#0011ee0f" } },
      4: { value: { _dark: "#4d58ff5a", base: "#000bff19" } },
      5: { value: { _dark: "#5b62fd6b", base: "#000eff25" } },
      6: { value: { _dark: "#6d6ffd7a", base: "#000aff34" } },
      7: { value: { _dark: "#7777fe8e", base: "#0008e647" } },
      8: { value: { _dark: "#7b7afeac", base: "#0008d964" } },
      9: { value: { _dark: "#6a6afed4", base: "#0000c0a4" } },
      10: { value: { _dark: "#7d79ffdc", base: "#0000b6ae" } },
      11: { value: { _dark: "#b1a9ff", base: "#0600abac" } },
      12: { value: { _dark: "#e1e0fffe", base: "#000246d8" } },
    },
    jade: {
      1: { value: { _dark: "#00de4505", base: "#00c08004" } },
      2: { value: { _dark: "#27fba60c", base: "#00a3460b" } },
      3: { value: { _dark: "#02f99920", base: "#00ae4819" } },
      4: { value: { _dark: "#00ffaa2d", base: "#00a85129" } },
      5: { value: { _dark: "#11ffb63b", base: "#00a2553c" } },
      6: { value: { _dark: "#34ffc24b", base: "#009a5753" } },
      7: { value: { _dark: "#45fdc75e", base: "#00945f74" } },
      8: { value: { _dark: "#48ffcf75", base: "#00976ea9" } },
      9: { value: { _dark: "#38feca9d", base: "#00916bd6" } },
      10: { value: { _dark: "#31fec7ab", base: "#008764d9" } },
      11: { value: { _dark: "#21fec0d6", base: "#007152df" } },
      12: { value: { _dark: "#b8ffe1ef", base: "#002217e2" } },
    },
    lime: {
      1: { value: { _dark: "#11bb0003", base: "#66990005" } },
      2: { value: { _dark: "#78f7000a", base: "#6b95000c" } },
      3: { value: { _dark: "#9bfd4c1a", base: "#96c80029" } },
      4: { value: { _dark: "#a7fe5c29", base: "#8fc60042" } },
      5: { value: { _dark: "#affe6537", base: "#81bb0059" } },
      6: { value: { _dark: "#b2fe6d46", base: "#72aa006e" } },
      7: { value: { _dark: "#b6ff6f57", base: "#61990087" } },
      8: { value: { _dark: "#b6fd6d6c", base: "#559200ab" } },
      9: { value: { _dark: "#caff69ed", base: "#93e4009c" } },
      10: { value: { _dark: "#d4ff70", base: "#8fdc00b3" } },
      11: { value: { _dark: "#d1fe77e4", base: "#375f00d0" } },
      12: { value: { _dark: "#e9febff7", base: "#1e2900e3" } },
    },
    mauve: {
      1: { value: { _dark: "#00000000", base: "#55005503" } },
      2: { value: { _dark: "#f5f4f609", base: "#2b005506" } },
      3: { value: { _dark: "#ebeaf814", base: "#30004010" } },
      4: { value: { _dark: "#eee5f81d", base: "#20003618" } },
      5: { value: { _dark: "#efe6fe25", base: "#20003820" } },
      6: { value: { _dark: "#f1e6fd30", base: "#14003527" } },
      7: { value: { _dark: "#eee9ff40", base: "#10003332" } },
      8: { value: { _dark: "#eee7ff5d", base: "#08003145" } },
      9: { value: { _dark: "#eae6fd6e", base: "#05001d73" } },
      10: { value: { _dark: "#ece9fd7c", base: "#0500197d" } },
      11: { value: { _dark: "#f5f1ffb7", base: "#0400119c" } },
      12: { value: { _dark: "#fdfdffef", base: "#020008e0" } },
    },
    mint: {
      1: { value: { _dark: "#00dede05", base: "#00d5aa06" } },
      2: { value: { _dark: "#00f9f90b", base: "#00b18a0d" } },
      3: { value: { _dark: "#00fff61d", base: "#00d29e22" } },
      4: { value: { _dark: "#00fff42c", base: "#00cc9937" } },
      5: { value: { _dark: "#00fff23a", base: "#00c0914c" } },
      6: { value: { _dark: "#0effeb4a", base: "#00b08663" } },
      7: { value: { _dark: "#34fde55e", base: "#00a17d81" } },
      8: { value: { _dark: "#41ffdf76", base: "#009e7fb3" } },
      9: { value: { _dark: "#92ffe7e9", base: "#00d3a579" } },
      10: { value: { _dark: "#aefeedf5", base: "#00c39982" } },
      11: { value: { _dark: "#67ffded2", base: "#007763fd" } },
      12: { value: { _dark: "#cbfee9f5", base: "#00312ae9" } },
    },
    olive: {
      1: { value: { _dark: "#00000000", base: "#00550003" } },
      2: { value: { _dark: "#f1f2f008", base: "#00490007" } },
      3: { value: { _dark: "#f4f5f312", base: "#00200010" } },
      4: { value: { _dark: "#f3fef21a", base: "#00160018" } },
      5: { value: { _dark: "#f2fbf122", base: "#00180020" } },
      6: { value: { _dark: "#f4faed2c", base: "#00140028" } },
      7: { value: { _dark: "#f2fced3b", base: "#000f0033" } },
      8: { value: { _dark: "#edfdeb57", base: "#040f0047" } },
      9: { value: { _dark: "#ebfde766", base: "#050f0078" } },
      10: { value: { _dark: "#f0fdec74", base: "#040e0082" } },
      11: { value: { _dark: "#f6fef4b0", base: "#020a00a0" } },
      12: { value: { _dark: "#fdfffded", base: "#010600e3" } },
    },
    orange: {
      1: { value: { _dark: "#ec360007", base: "#c0400004" } },
      2: { value: { _dark: "#fe6d000e", base: "#ff8e0012" } },
      3: { value: { _dark: "#fb6a0025", base: "#ff9c0029" } },
      4: { value: { _dark: "#ff590039", base: "#ff91014a" } },
      5: { value: { _dark: "#ff61004a", base: "#ff8b0065" } },
      6: { value: { _dark: "#fd75045c", base: "#ff81007d" } },
      7: { value: { _dark: "#ff832c75", base: "#ed6c008c" } },
      8: { value: { _dark: "#fe84389d", base: "#e35f00aa" } },
      9: { value: { _dark: "#fe6d15f7", base: "#f65e00ea" } },
      10: { value: { _dark: "#ff801f", base: "#ef5f00" } },
      11: { value: { _dark: "#ffa057", base: "#cc4e00" } },
      12: { value: { _dark: "#ffe0c2", base: "#431200e2" } },
    },
    pink: {
      1: { value: { _dark: "#f412bc09", base: "#ff00aa03" } },
      2: { value: { _dark: "#f420bb12", base: "#e0008008" } },
      3: { value: { _dark: "#fe37cc29", base: "#f4008c16" } },
      4: { value: { _dark: "#fc1ec43f", base: "#e2008b23" } },
      5: { value: { _dark: "#fd35c24e", base: "#d1008331" } },
      6: { value: { _dark: "#fd51c75f", base: "#c0007840" } },
      7: { value: { _dark: "#fd62c87b", base: "#b6006f53" } },
      8: { value: { _dark: "#ff68c8a2", base: "#af006f6c" } },
      9: { value: { _dark: "#fe49bcd4", base: "#c8007fbf" } },
      10: { value: { _dark: "#ff5cc0dc", base: "#c2007ac7" } },
      11: { value: { _dark: "#ff8dcc", base: "#b60074d6" } },
      12: { value: { _dark: "#ffd3ecfd", base: "#59003bed" } },
    },
    plum: {
      1: { value: { _dark: "#f112f108", base: "#aa00ff03" } },
      2: { value: { _dark: "#f22ff211", base: "#c000c008" } },
      3: { value: { _dark: "#fd4cfd27", base: "#cc00cc14" } },
      4: { value: { _dark: "#f646ff3a", base: "#c200c921" } },
      5: { value: { _dark: "#f455ff48", base: "#b700bd2e" } },
      6: { value: { _dark: "#f66dff56", base: "#a400b03d" } },
      7: { value: { _dark: "#f07cfd70", base: "#9900a852" } },
      8: { value: { _dark: "#ee84ff95", base: "#9000a56e" } },
      9: { value: { _dark: "#e961feb6", base: "#89009eb5" } },
      10: { value: { _dark: "#ed70ffc0", base: "#7f0092bb" } },
      11: { value: { _dark: "#f19cfef3", base: "#730086c1" } },
      12: { value: { _dark: "#feddfef4", base: "#40004be6" } },
    },
    purple: {
      1: { value: { _dark: "#5100fb0c", base: "#aa00ff03" } },
      2: { value: { _dark: "#871bfd1a", base: "#8000ff08" } },
      3: { value: { _dark: "#9a27ff3a", base: "#9400ff13" } },
      4: { value: { _dark: "#9d27fe54", base: "#8c00ff1f" } },
      5: { value: { _dark: "#a132ff65", base: "#8800ff2d" } },
      6: { value: { _dark: "#a943ff76", base: "#8000ff3e" } },
      7: { value: { _dark: "#af52ff92", base: "#7d00ff56" } },
      8: { value: { _dark: "#b156ffc3", base: "#7d00fd75" } },
      9: { value: { _dark: "#ad46ff", base: "#8e00ffb9" } },
      10: { value: { _dark: "#aa38ffef", base: "#8700ecca" } },
      11: { value: { _dark: "#d29bff", base: "#7900cddc" } },
      12: { value: { _dark: "#edd6ff", base: "#42006ff6" } },
    },
    red: {
      1: { value: { _dark: "#f4121209", base: "#ff000003" } },
      2: { value: { _dark: "#f22f3e11", base: "#ff000008" } },
      3: { value: { _dark: "#ff173f2d", base: "#f3000d14" } },
      4: { value: { _dark: "#fe0a3b44", base: "#ff000824" } },
      5: { value: { _dark: "#ff204756", base: "#ff000632" } },
      6: { value: { _dark: "#ff3e5668", base: "#f8000442" } },
      7: { value: { _dark: "#ff536184", base: "#df000356" } },
      8: { value: { _dark: "#ff5d61b0", base: "#d2000571" } },
      9: { value: { _dark: "#fe4e54e4", base: "#db0007b7" } },
      10: { value: { _dark: "#ff6465eb", base: "#d10005c1" } },
      11: { value: { _dark: "#ff9592", base: "#c40006d3" } },
      12: { value: { _dark: "#ffd1d9", base: "#55000de8" } },
    },
    ruby: {
      1: { value: { _dark: "#f4124a09", base: "#ff005503" } },
      2: { value: { _dark: "#fe5a7f0e", base: "#ff002008" } },
      3: { value: { _dark: "#ff235d2c", base: "#f3002515" } },
      4: { value: { _dark: "#fd195e42", base: "#ff002523" } },
      5: { value: { _dark: "#fe2d6b53", base: "#ff002a31" } },
      6: { value: { _dark: "#ff447665", base: "#e4002440" } },
      7: { value: { _dark: "#ff577d80", base: "#ce002553" } },
      8: { value: { _dark: "#ff5c7cae", base: "#c300286d" } },
      9: { value: { _dark: "#fe4c70e4", base: "#db002cb9" } },
      10: { value: { _dark: "#ff617beb", base: "#d2002cc4" } },
      11: { value: { _dark: "#ff949d", base: "#c10030db" } },
      12: { value: { _dark: "#ffd3e2fe", base: "#550016e8" } },
    },
    sage: {
      1: { value: { _dark: "#00000000", base: "#00804004" } },
      2: { value: { _dark: "#f0f2f108", base: "#00402008" } },
      3: { value: { _dark: "#f3f5f412", base: "#002d1e11" } },
      4: { value: { _dark: "#f2fefd1a", base: "#001f1519" } },
      5: { value: { _dark: "#f1fbfa22", base: "#00180820" } },
      6: { value: { _dark: "#edfbf42d", base: "#00140d28" } },
      7: { value: { _dark: "#edfcf73c", base: "#00140a34" } },
      8: { value: { _dark: "#ebfdf657", base: "#000f0847" } },
      9: { value: { _dark: "#dffdf266", base: "#00110b79" } },
      10: { value: { _dark: "#e5fdf674", base: "#00100a83" } },
      11: { value: { _dark: "#f4fefbb0", base: "#000a07a0" } },
      12: { value: { _dark: "#fdfffeed", base: "#000805e5" } },
    },
    sand: {
      1: { value: { _dark: "#00000000", base: "#55550003" } },
      2: { value: { _dark: "#f4f4f309", base: "#25250007" } },
      3: { value: { _dark: "#f6f6f513", base: "#20100010" } },
      4: { value: { _dark: "#fefef31b", base: "#1f150019" } },
      5: { value: { _dark: "#fbfbeb23", base: "#1f180021" } },
      6: { value: { _dark: "#fffaed2d", base: "#19130029" } },
      7: { value: { _dark: "#fffbed3c", base: "#19140035" } },
      8: { value: { _dark: "#fff9eb57", base: "#1915014a" } },
      9: { value: { _dark: "#fffae965", base: "#0f0f0079" } },
      10: { value: { _dark: "#fffdee73", base: "#0c0c0083" } },
      11: { value: { _dark: "#fffcf4b0", base: "#080800a1" } },
      12: { value: { _dark: "#fffffded", base: "#060500e3" } },
    },
    sky: {
      1: { value: { _dark: "#0044ff0f", base: "#00d5ff06" } },
      2: { value: { _dark: "#1171fb18", base: "#00a4db0e" } },
      3: { value: { _dark: "#1184fc33", base: "#00b3ee1e" } },
      4: { value: { _dark: "#128fff49", base: "#00ace42e" } },
      5: { value: { _dark: "#1c9dfd5d", base: "#00a1d841" } },
      6: { value: { _dark: "#28a5ff72", base: "#0092ca56" } },
      7: { value: { _dark: "#2badfe8b", base: "#0089c172" } },
      8: { value: { _dark: "#1db2fea9", base: "#0085bf9f" } },
      9: { value: { _dark: "#7ce3fffe", base: "#00c7fe83" } },
      10: { value: { _dark: "#a8eeff", base: "#00bcf38b" } },
      11: { value: { _dark: "#7cd3ffef", base: "#00749e" } },
      12: { value: { _dark: "#c2f3ff", base: "#002540e2" } },
    },
    slate: {
      1: { value: { _dark: "#00000000", base: "#00005503" } },
      2: { value: { _dark: "#d8f4f609", base: "#00005506" } },
      3: { value: { _dark: "#ddeaf814", base: "#0000330f" } },
      4: { value: { _dark: "#d3edf81d", base: "#00002d17" } },
      5: { value: { _dark: "#d9edfe25", base: "#0009321f" } },
      6: { value: { _dark: "#d6ebfd30", base: "#00002f26" } },
      7: { value: { _dark: "#d9edff40", base: "#00062e32" } },
      8: { value: { _dark: "#d9edff5d", base: "#00083046" } },
      9: { value: { _dark: "#dfebfd6d", base: "#00051d74" } },
      10: { value: { _dark: "#e5edfd7b", base: "#00071b7f" } },
      11: { value: { _dark: "#f1f7feb5", base: "#0007149f" } },
      12: { value: { _dark: "#fcfdffef", base: "#000509e3" } },
    },
    teal: {
      1: { value: { _dark: "#00deab05", base: "#00cc9905" } },
      2: { value: { _dark: "#12fbe60c", base: "#00aa800c" } },
      3: { value: { _dark: "#00ffe61e", base: "#00c69d1f" } },
      4: { value: { _dark: "#00ffe92d", base: "#00c39633" } },
      5: { value: { _dark: "#00ffea3b", base: "#00b49047" } },
      6: { value: { _dark: "#1cffe84b", base: "#00a6855e" } },
      7: { value: { _dark: "#2efde85f", base: "#0099807c" } },
      8: { value: { _dark: "#32ffe775", base: "#009783ac" } },
      9: { value: { _dark: "#13ffe49f", base: "#009e8ced" } },
      10: { value: { _dark: "#0dffe0ae", base: "#009684f2" } },
      11: { value: { _dark: "#0afed5d6", base: "#008573" } },
      12: { value: { _dark: "#b8ffebef", base: "#00332df2" } },
    },
    tomato: {
      1: { value: { _dark: "#f1121208", base: "#ff000003" } },
      2: { value: { _dark: "#ff55330f", base: "#ff200008" } },
      3: { value: { _dark: "#ff35232b", base: "#f52b0018" } },
      4: { value: { _dark: "#fd201142", base: "#ff35002c" } },
      5: { value: { _dark: "#fe333153", base: "#ff2e003d" } },
      6: { value: { _dark: "#ff4f3864", base: "#f92d0050" } },
      7: { value: { _dark: "#fd644a7d", base: "#e7280067" } },
      8: { value: { _dark: "#fe6d4ea7", base: "#db250084" } },
      9: { value: { _dark: "#fe5431e4", base: "#df2600d1" } },
      10: { value: { _dark: "#ff6847eb", base: "#d72400da" } },
      11: { value: { _dark: "#ff977d", base: "#cd2200ea" } },
      12: { value: { _dark: "#ffd6cefb", base: "#460900e0" } },
    },
    violet: {
      1: { value: { _dark: "#2200ff0f", base: "#5500ff03" } },
      2: { value: { _dark: "#5d2efe1b", base: "#2500ff07" } },
      3: { value: { _dark: "#7331fd41", base: "#3000ff10" } },
      4: { value: { _dark: "#742cfd5f", base: "#4000ff1c" } },
      5: { value: { _dark: "#7d3afd6f", base: "#4500ff29" } },
      6: { value: { _dark: "#854bfd7f", base: "#3f00ff39" } },
      7: { value: { _dark: "#8b56fe9a", base: "#3e00ff4f" } },
      8: { value: { _dark: "#905cfec5", base: "#4600ff6e" } },
      9: { value: { _dark: "#8e51ff", base: "#5a00ffae" } },
      10: { value: { _dark: "#8a44ffef", base: "#5300e5bb" } },
      11: { value: { _dark: "#bda3ff", base: "#4c00cdc6" } },
      12: { value: { _dark: "#e3daff", base: "#250062e6" } },
    },
    yellow: {
      1: { value: { _dark: "#d1510004", base: "#aaaa0006" } },
      2: { value: { _dark: "#f9b4000b", base: "#f4dd0016" } },
      3: { value: { _dark: "#ffaa001e", base: "#ffee0047" } },
      4: { value: { _dark: "#fdb70028", base: "#ffe3016b" } },
      5: { value: { _dark: "#febb0036", base: "#ffd5008f" } },
      6: { value: { _dark: "#fec40046", base: "#ebbc0097" } },
      7: { value: { _dark: "#fdcb225c", base: "#d2a10098" } },
      8: { value: { _dark: "#fdca327b", base: "#c99700c6" } },
      9: { value: { _dark: "#ffe629", base: "#ffe100d6" } },
      10: { value: { _dark: "#ffff57", base: "#ffdc00" } },
      11: { value: { _dark: "#fee949f5", base: "#9e6c00" } },
      12: { value: { _dark: "#fef6baf6", base: "#2e2000e0" } },
    },
  },
  text: {
    app: {
      value: {
        _dark: "#ffffffed",
        base: "#1b1b1b",
      },
    },
    error: {
      value: {
        _dark: "#ff6465eb",
        base: "#c40006d3",
      },
    },
    extraMuted: { value: { _dark: "#e8e8e866", base: "#0a121766" } },
    illustration: {
      value: {
        _dark: "#ffffff55",
        base: "#00000044",
      },
    },
    label: {
      value: {
        _dark: "#ffffffaf",
        base: "#0000009b",
      },
    },
    muted: {
      value: {
        _dark: "#e8e8e899",
        base: "#0a121799",
      },
    },
    placeholder: {
      value: {
        _dark: "#ffffff72",
        base: "#0000009b",
      },
    },
    success: { value: "{colors.palette.green.9}" },
    warning: {
      value: {
        _dark: "#ffca16",
        base: "#ab6400",
      },
    },
    toolbar: {
      value: {
        _dark: "#ffffffed",
        base: "#fcfcfd",
      },
    },
    white: {
      value: {
        _dark: "#ffffff",
        base: "#ffffff",
      },
    },
  },
  user: {
    alpha: {
      added: {
        value: {
          _dark: "#22C55E3D",
          base: "#22C55E3D",
        },
      },
      amber: {
        value: {
          _dark: "#FAC00024",
          base: "#FFDE003D",
        },
      },
      bronze: {
        value: {
          _dark: "#F7E4881E",
          base: "#92250015",
        },
      },
      brown: {
        value: {
          _dark: "#F8D56C1F",
          base: "#A04B0018",
        },
      },
      crimson: {
        value: {
          _dark: "#FE4B6031",
          base: "#FF005216",
        },
      },
      cyan: {
        value: {
          _dark: "#00F3FD27",
          base: "#00C2D121",
        },
      },
      gold: {
        value: {
          _dark: "#FFF47F1C",
          base: "#75600018",
        },
      },
      grass: {
        value: {
          _dark: "#8DFF6223",
          base: "#00970016",
        },
      },
      gray: {
        value: {
          _dark: "#ECFBE82C",
          base: "#0000000F",
        },
      },
      green: {
        value: {
          _dark: "#35ff4f1d",
          base: "#00d4121d",
        },
      },
      indigo: {
        value: {
          _dark: "#3d44fe46",
          base: "#002dff11",
        },
      },
      iris: {
        value: {
          _dark: "#6A7AFF3A",
          base: "#0011EE0F",
        },
      },
      jade: {
        value: {
          _dark: "#1CFA8428",
          base: "#00AE4819",
        },
      },
      lime: {
        value: {
          _dark: "#B6FF2F22",
          base: "#96C80029",
        },
      },
      mint: {
        value: {
          _dark: "#1EF99826",
          base: "#00D29E22",
        },
      },
      orange: {
        value: {
          _dark: "#FD79062D",
          base: "#FF9C0029",
        },
      },
      pink: {
        value: {
          _dark: "#FE579130",
          base: "#F4008C16",
        },
      },
      plum: {
        value: {
          _dark: "#FD72ED2B",
          base: "#CC00CC14",
        },
      },
      purple: {
        value: {
          _dark: "#9a27ff3a",
          base: "#9400ff13",
        },
      },
      red: {
        value: {
          _dark: "#FE3E1633",
          base: "#F3000D14",
        },
      },
      ruby: {
        value: {
          _dark: "#FE443A32",
          base: "#F3002515",
        },
      },
      sand: {
        value: {
          _dark: "#ECFBE82C",
          base: "#20100010",
        },
      },
      sky: {
        value: {
          _dark: "#00EEFE29",
          base: "#00B3EE1E",
        },
      },
      teal: {
        value: {
          _dark: "#23F9A827",
          base: "#00C69D1F",
        },
      },
      tomato: {
        value: {
          _dark: "#FE570C30",
          base: "#F52B0018",
        },
      },
      violet: {
        value: {
          _dark: "#7331fd41",
          base: "#3000ff10",
        },
      },
      yellow: {
        value: {
          _dark: "#F9E70020",
          base: "#FFEE0047",
        },
      },
    },
    solid: {
      added: {
        value: {
          _dark: "#22C55E",
          base: "#22C55E",
        },
      },
      amber: {
        value: {
          _dark: "#FFC53D",
          base: "#FFBA18",
        },
      },
      bronze: {
        value: {
          _dark: "#AE8C7E",
          base: "#957468",
        },
      },
      brown: {
        value: {
          _dark: "#B88C67",
          base: "#A07553",
        },
      },
      crimson: {
        value: {
          _dark: "#EE518A",
          base: "#DF3478",
        },
      },
      cyan: {
        value: {
          _dark: "#23AFD0",
          base: "#0797B9",
        },
      },
      gold: {
        value: {
          _dark: "#A39073",
          base: "#8C7A5E",
        },
      },
      grass: {
        value: {
          _dark: "#53B365",
          base: "#3E9B4F",
        },
      },
      gray: {
        value: {
          _dark: "#7B7B7B",
          base: "#838383",
        },
      },
      green: {
        value: {
          _dark: "#17bb4d",
          base: "#00bd44",
        },
      },
      indigo: {
        value: {
          _dark: "#585cd5",
          base: "#5754e7",
        },
      },
      iris: {
        value: {
          _dark: "#6E6ADE",
          base: "#5151CD",
        },
      },
      jade: {
        value: {
          _dark: "#27B08B",
          base: "#26997B",
        },
      },
      lime: {
        value: {
          _dark: "#577538",
          base: "#5C7C2F",
        },
      },
      mint: {
        value: {
          _dark: "#277F70",
          base: "#027864",
        },
      },
      orange: {
        value: {
          _dark: "#FF801F",
          base: "#EF5F00",
        },
      },
      pink: {
        value: {
          _dark: "#DE51A8",
          base: "#CF3897",
        },
      },
      plum: {
        value: {
          _dark: "#B658C4",
          base: "#A144AF",
        },
      },
      purple: {
        value: {
          _dark: "#a035f0",
          base: "#a035f0",
        },
      },
      red: {
        value: {
          _dark: "#EC5D5E",
          base: "#DC3E42",
        },
      },
      ruby: {
        value: {
          _dark: "#EC5A72",
          base: "#DC3B5D",
        },
      },
      sand: {
        value: {
          _dark: "#7C7B74",
          base: "#82827C",
        },
      },
      sky: {
        value: {
          _dark: "#197CAE",
          base: "#00749E",
        },
      },
      teal: {
        value: {
          _dark: "#0EB39E",
          base: "#0D9B8A",
        },
      },
      tomato: {
        value: {
          _dark: "#EC6142",
          base: "#DD4425",
        },
      },
      violet: {
        value: {
          _dark: "#8241f0",
          base: "#8144ec",
        },
      },
      yellow: {
        value: {
          _dark: "#836A21",
          base: "#9E6C00",
        },
      },
    },
    text: {
      added: {
        value: {
          _dark: "#AEF5BB",
          base: "#0E3F1D",
        },
      },
      amber: {
        value: {
          _dark: "#FEE7BA",
          base: "#4F3422",
        },
      },
      bronze: {
        value: {
          _dark: "#F3E2DC",
          base: "#43302B",
        },
      },
      brown: {
        value: {
          _dark: "#F6DFCC",
          base: "#3E332E",
        },
      },
      crimson: {
        value: {
          _dark: "#FFD3DE",
          base: "#621639",
        },
      },
      cyan: {
        value: {
          _dark: "#B8EAFC",
          base: "#0D3C48",
        },
      },
      gold: {
        value: {
          _dark: "#EFE5D7",
          base: "#3B352B",
        },
      },
      grass: {
        value: {
          _dark: "#C0F0C4",
          base: "#203C25",
        },
      },
      gray: {
        value: {
          _dark: "#EEEEEE",
          base: "#000000DF",
        },
      },
      green: {
        value: {
          _dark: "#aef5b7",
          base: "#094018",
        },
      },
      indigo: {
        value: {
          _dark: "#d8e0ff",
          base: "#25256b",
        },
      },
      iris: {
        value: {
          _dark: "#DCE1FF",
          base: "#272962",
        },
      },
      jade: {
        value: {
          _dark: "#AAF0D8",
          base: "#1D3B31",
        },
      },
      lime: {
        value: {
          _dark: "#DFF8BC",
          base: "#37401C",
        },
      },
      mint: {
        value: {
          _dark: "#C0F5E8",
          base: "#16433C",
        },
      },
      orange: {
        value: {
          _dark: "#FFDCCA",
          base: "#582D1D",
        },
      },
      pink: {
        value: {
          _dark: "#FED1E8",
          base: "#651249",
        },
      },
      plum: {
        value: {
          _dark: "#F2D5F6",
          base: "#53195D",
        },
      },
      purple: {
        value: {
          _dark: "#edd6ff",
          base: "#490974",
        },
      },
      red: {
        value: {
          _dark: "#FFD2CE",
          base: "#641723",
        },
      },
      ruby: {
        value: {
          _dark: "#FFD2D6",
          base: "#64172B",
        },
      },
      sand: {
        value: {
          _dark: "#EEEEEE",
          base: "#21201C",
        },
      },
      sky: {
        value: {
          _dark: "#C3F2FF",
          base: "#1D3E56",
        },
      },
      teal: {
        value: {
          _dark: "#AAF0E3",
          base: "#0D3D38",
        },
      },
      tomato: {
        value: {
          _dark: "#FBD3CA",
          base: "#5C271F",
        },
      },
      violet: {
        value: {
          _dark: "#e3daff",
          base: "#3a1971",
        },
      },
      yellow: {
        value: {
          _dark: "#F4EDB8",
          base: "#473B1F",
        },
      },
    },
  },
})

export const USER_COLORS = [
  "added",
  "gray",
  "sand",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "bronze",
  "gold",
  "brown",
  "orange",
  "amber",
  "yellow",
  "lime",
  "mint",
  "sky",
]

// Explicit palette paths for staticCss — globs like `palette.*` are not expanded here.
export const RUNTIME_COLOR_PALETTES = [
  ...Object.keys(semanticColors.palette).map((color) => `palette.${color}`),
  ...Object.keys(semanticColors.brand).map((color) => `brand.${color}`),
]
