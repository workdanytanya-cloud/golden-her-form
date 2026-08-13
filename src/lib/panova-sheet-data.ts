/* eslint-disable */
/** Auto-generated from Google Sheet — do not edit by hand.
 * Source: https://docs.google.com/spreadsheets/d/1SU_RzbakfsSb5UAb7u1JO0yvib3GI8rPQa3E4_5Xa3g/edit
 * Exercises: 187
 */
export const PANOVA_SHEET_SOURCE = "https://docs.google.com/spreadsheets/d/1SU_RzbakfsSb5UAb7u1JO0yvib3GI8rPQa3E4_5Xa3g/edit";

export type PanovaSheetItem = {
  slug: string | null;
  name: string;
  video_url: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  note: string | null;
  section: "warmup" | "exercises" | "cooldown";
};

export type PanovaSheetWorkout = {
  title: string;
  focus: string | null;
  items: PanovaSheetItem[];
};

export type PanovaSheetWeek = {
  weekIndex: number;
  workouts: PanovaSheetWorkout[];
};

export const PANOVA_SHEET_SLUGS: readonly string[] = [
  "sheet-beg",
  "sheet-bitseps-sidya-na-stule",
  "sheet-bokovye-naklony-prised-naklony-k-polu-dzhamping-dzhek",
  "sheet-bokovye-skruchivaniya-polulezha",
  "sheet-bokovye-shagi-v-poluprisede-bez-otyagoscheniya",
  "sheet-vybros-giri-pered-soboy",
  "sheet-vybros-giri-pered-soboy-2",
  "sheet-vypady-v-pruzhinke-otvedenie-nogi-nazad",
  "sheet-vypady-v-pryzhke-yagodichnyy-mostik-dzhamping-dzhek-otvedeni",
  "sheet-vypady-iz-polupriseda",
  "sheet-vypady-s-podemom-ganteli-nad-golovoy",
  "sheet-vypady-prisedanie-lodochka-vypady-s-podemom-bedra-press",
  "sheet-dzhamping-dzhek-press-beg-s-vysokim-ponimaniem-bedra-hodba-l",
  "sheet-dzhamping-dzhek-giperekstenziya-vypad-naklon-vpered-poochere",
  "sheet-zhim-sidya-podemy-sidya-v-naklone",
  "sheet-zhim-espandera-press",
  "sheet-zhuravlik",
  "sheet-zaminka",
  "sheet-zashagivanie-na-stul",
  "sheet-iz-planki-kasanie-delt-v-polozhenie-stoya-press-sklepka-na-c",
  "sheet-kacheli",
  "sheet-knizhka-na-stule",
  "sheet-kompleks-1",
  "sheet-kompleks-2",
  "sheet-kompleks-uprazhneniy-sidya-na-stule-verh",
  "sheet-kompleks-uprazhneniy-sidya-na-stule-niz",
  "sheet-krug-1",
  "sheet-krug-1-2",
  "sheet-krug-1-3",
  "sheet-lodochka",
  "sheet-lodochka-plovets",
  "sheet-lodochka-gusenitsa-setapy",
  "sheet-lodochka-gusenitsa-setapy-2",
  "sheet-mahi-ganteley-v-storony",
  "sheet-mahi-ganteley-sidya-v-naklone",
  "sheet-mahi-gantel-sidya-na-stule",
  "sheet-mahi-cherez-storony-poperemenno",
  "sheet-mertvaya-tyaga-prised-gantelya-nad-soboi",
  "sheet-naklony",
  "sheet-naklony-2",
  "sheet-naklony-na-odnoi-noge",
  "sheet-nedelya",
  "sheet-obratnye-otzhimaniya",
  "sheet-obratnye-otzhimaniya-2",
  "sheet-obratnye-otzhimaniya-3",
  "sheet-obratnye-otzhimaniya-ot-stula",
  "sheet-otvedenie-nogi",
  "sheet-otvedenie-nogi-v-naklone-stoya",
  "sheet-otvedenie-nogi-nazad-i-v-storonu",
  "sheet-otvedenie-nogi-nazad-podem-ganteli-nad-golovoy",
  "sheet-otvedenie-sognutoi-nogi-nazad-stoya",
  "sheet-otvedenie-sognutoi-nogi-nazad-stoya-2",
  "sheet-otvedenie-taza-nazad-s-kolen",
  "sheet-otvedenie-taza-s-zakruchivaniyami",
  "sheet-otvedenie-taza-s-zakruchivaniyami-2",
  "sheet-otzhimanie-podem-ruki",
  "sheet-otzhimaniya-ot-steny",
  "sheet-otzhimaniya-ot-steny-2",
  "sheet-otzhimaniya-ot-steny-3",
  "sheet-otzhimaniya-s-kolen-na-tritseps",
  "sheet-otzhimaniya-s-kolen-kasanie-delt-skruchivaniya-na-press-shag",
  "sheet-otzhimaniya-so-sredney-postanovkoy-ruk",
  "sheet-otzhimaniya-shirokim-hvatom",
  "sheet-planka",
  "sheet-planka-na-pryamyh-rukah",
  "sheet-planka-na-pryamyh-rukah-planka-na-loktyah",
  "sheet-plyus",
  "sheet-podem-bokovoy-nogi",
  "sheet-podem-v-diagonal-razvedenie",
  "sheet-podem-ganteley-na-bitseps-v-naklone",
  "sheet-podem-gantelei-pered-soboi",
  "sheet-podem-ganteli-pered-soboi-sidya-na-stule",
  "sheet-podem-ganteli-otvedenie-nogi",
  "sheet-podem-gantel-sidya-v-naklone",
  "sheet-podem-na-bitseps-s-rezinoi",
  "sheet-podem-na-bitseps-u-steny",
  "sheet-podem-na-noski-sidya",
  "sheet-pode-m-na-noski-stoya",
  "sheet-podem-ruk-iz-planki",
  "sheet-pode-my-gantelei-na-bitseps-v-naklone",
  "sheet-press",
  "sheet-press-2",
  "sheet-press-iz-polozheniya-lodki",
  "sheet-press-s-gantelei",
  "sheet-press-s-gantelei-2",
  "sheet-prised-vypad",
  "sheet-prised-skruchivaniya",
  "sheet-prised-i-otvedenie-nogi-v-storonu",
  "sheet-prised-i-otvedenie-nogi-nazad",
  "sheet-prised-s-girei-otvedenie-taza-nazad",
  "sheet-prised-s-kasaniem-pola-hodba-na-ladonyah-poocherednye-vypady",
  "sheet-prised-s-pruzhinkoi",
  "sheet-prised-s-pruzhinkoy-lodochka-poocheredno-skruchivaniya-na-pr",
  "sheet-prised-podem-ganteli-nad-golovoy",
  "sheet-prised-podem-na-noski-s-podnyatiem-ruk-press-prised-s-rukami",
  "sheet-prised-podem-na-noski-prised-podem-na-noski-s-podnyatiem-ruk",
  "sheet-prised-skruchivanie",
  "sheet-prisedaniya",
  "sheet-prisedaniya-na-stul-na-odnoi-noge",
  "sheet-prisedaniya-s-aktsentom-na-odnu-nogu",
  "sheet-prisedaniya-s-kasaniem-ladonei",
  "sheet-prisedaniya-s-kasaniem-stula",
  "sheet-pronatsiya-gantel-i-podem-gantel-nad-golovoy",
  "sheet-pryzhki-podem-gantelei-pered-soboi",
  "sheet-pryzhki-s-kasaniem-pola",
  "sheet-razvedenie-nog-na-polu",
  "sheet-razvedenie-nog-s-pola",
  "sheet-razvedenie-nog-s-rezinkoy",
  "sheet-razvodka-gantelei-lezha",
  "sheet-razvodka-gantelei-lezha-2",
  "sheet-razgibaniya-na-tritseps-v-naklone",
  "sheet-razgibaniya-na-tritseps-v-naklone-2",
  "sheet-razminka",
  "sheet-razminka-2",
  "sheet-razryvy-reziny-pered-soboi",
  "sheet-russkii-tvist-s-nogami-na-vesu",
  "sheet-russkii-tvist-s-nogami-na-vesu-2",
  "sheet-svedenie-nog-na-stule",
  "sheet-sgibanie-nog-stoya-s-rezinkoi",
  "sheet-setapy",
  "sheet-skalolaz-vypady-nazad-i-vpered-otzhimaniya-ot-pola-vypady-vp",
  "sheet-skruchivaniya",
  "sheet-skruchivaniya-koleni-k-loktyam",
  "sheet-skruchivaniya-na-spinu-s-pryamoi-rukoi",
  "sheet-skruchivaniya-na-stule",
  "sheet-skruchivaniya-stoya-kompleks",
  "sheet-skruchivaniya-spina",
  "sheet-sobachya-stoyka",
  "sheet-spina-grud",
  "sheet-spina-grud-2",
  "sheet-supermen",
  "sheet-supermen-2",
  "sheet-supermen-planka-press",
  "sheet-supermen-plechi",
  "sheet-trastery",
  "sheet-trastery-2",
  "sheet-tyaga-amortizatora-sidya-na-stule",
  "sheet-tyaga-amortizatora-sidya-na-stule-2",
  "sheet-tyaga-ganteli-v-upore",
  "sheet-tyaga-ganteli-k-poyasu-v-upore-na-stul",
  "sheet-tyaga-ganteli-k-poyasu-v-upore-na-stul-2",
  "sheet-tyaga-rezinki-za-golovu",
  "sheet-tyaga-rezinki-za-golovu-2",
  "sheet-tyaga-rezinki-sidya-na-stule",
  "sheet-tyaga-rezinki-sidya-na-stule-2",
  "sheet-uprazhnenie-p-pjb-jdgjpy0kiplgfkh1w",
  "sheet-uprazhnenie-p-038n-orpqmudzom6kbvqjw",
  "sheet-uprazhnenie-p-1e2mvrulgfvzwuevu6ll-w",
  "sheet-uprazhnenie-p-1lxkyejyyso7bpcv-0mcbq",
  "sheet-uprazhnenie-p-buqf1zkarfjukvc4i4wj5w",
  "sheet-uprazhnenie-p-fhorwv1-gana4clxrkwlvg",
  "sheet-uprazhnenie-p-i7npjb6wrsetqnbji0t7zw",
  "sheet-uprazhnenie-p-l52ern2bfcvfgzzzlwghzq",
  "sheet-uprazhnenie-p-lkckprqfi40pg4pzmxj6aq",
  "sheet-uprazhnenie-p-lvq7kpd0ogdsuistbu1tfg",
  "sheet-uprazhnenie-p-mcnj4x9dhy-skp565jwhba",
  "sheet-uprazhnenie-p-r9tn8f1u4zktdjokbkzciq",
  "sheet-uprazhnenie-p-rqwo68waj9ik58ubcyvdhg",
  "sheet-uprazhnenie-p-trt-puhqr4zqzbeozwrb6w",
  "sheet-uprazhnenie-p-ulmbzwcam-ve0svz7q-meq",
  "sheet-uprazhnenie-p-yuvcws-pxtp1wrbbb1fvtg",
  "sheet-uprazhnenie-p-zo61pfpw6p-midn6vb9qea",
  "sheet-uprazhnenie-7eknssuhvbi",
  "sheet-uprazhnenie-dbpjyr7d8by",
  "sheet-uprazhnenie-eo-zdto3fro",
  "sheet-uprazhnenie-gwzxyx0dy3m",
  "sheet-uprazhnenie-mchoqncebfg",
  "sheet-uprazhnenie-mjiwfarw-oq",
  "sheet-uprazhnenie-oxlx0wzyqmw",
  "sheet-uprazhnenie-pqjvdfkv3y4",
  "sheet-uprazhnenie-qrcrb1fzetu",
  "sheet-uprazhnenie-uvbykartlda",
  "sheet-uprazhnenie-w52dv4z6xqm",
  "sheet-uprazhnenie-x958i6apcmo",
  "sheet-fraztsuzskiy-zhim-ganteli-iz-za-golovy",
  "sheet-frantsuzskaii-zhim-lezha",
  "sheet-frantsuzskiy-zhim-gantel-sidya",
  "sheet-frantsuzskiy-zhim-lezha",
  "sheet-frantsuzskii-zhim-sidya",
  "sheet-frantsuzskiy-zhim-sidya-na-stule",
  "sheet-yagodichnyi-most-s-razvedeniem",
  "sheet-yagodichnyi-most-s-razvedeniem-2",
  "sheet-yagodichnyy-mostik",
  "sheet-yagodichnyy-mostik-2",
  "sheet-yagodichnyy-mostik-na-odnoy-noge-s-oporoy-na-stul",
  "sheet-yagodichnyi-mostik-na-pryamyh-rukah",
  "sheet-yagodichnyy-mostik-s-rezinkoy"
] as const;

export const PANOVA_4WEEK_PROGRAM: readonly PanovaSheetWeek[] = [
  {
    "weekIndex": 0,
    "workouts": [
      {
        "title": "Тренировка №1",
        "focus": "ТРЕНИРОВКА 1",
        "items": [
          {
            "slug": "sheet-razminka",
            "name": "Разминка",
            "video_url": "https://youtu.be/7SnqarWw7uo",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "warmup"
          },
          {
            "slug": "sheet-planka-na-pryamyh-rukah-planka-na-loktyah",
            "name": "Планка на прямых руках+планка на локтях",
            "video_url": "https://youtu.be/2-QrkMBkAko",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений каждого упражнения",
            "section": "exercises"
          },
          {
            "slug": "sheet-trastery",
            "name": "Трастеры",
            "video_url": "https://youtu.be/RbOJZZlyJXI",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-obratnye-otzhimaniya-3",
            "name": "Обратные отжимания",
            "video_url": "https://youtu.be/mltR7ses-yg",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-skruchivaniya-na-stule",
            "name": "Скручивания на стуле",
            "video_url": "https://youtu.be/SzC_2esO2AE",
            "sets": 4,
            "reps": "25",
            "rest_seconds": 45,
            "note": "4 подхода по 25 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-zaminka",
            "name": "Заминка",
            "video_url": "https://youtu.be/GxNpcq7ug7I",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "cooldown"
          }
        ]
      },
      {
        "title": "Тренировка №2",
        "focus": "ТРЕНИРОВКА 2",
        "items": [
          {
            "slug": "sheet-razminka",
            "name": "Разминка",
            "video_url": "https://youtu.be/7SnqarWw7uo",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "warmup"
          },
          {
            "slug": "sheet-supermen-planka-press",
            "name": "Супермен+Планка+Пресс",
            "video_url": "https://youtu.be/3uNa-vSYre8",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений каждого упражнения(планка 1 мин)",
            "section": "exercises"
          },
          {
            "slug": "sheet-otvedenie-sognutoi-nogi-nazad-stoya",
            "name": "Отведение согнутой ноги назад стоя",
            "video_url": "https://youtu.be/iHUDotVnhUY",
            "sets": 4,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "4 подхода по 15-20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-mertvaya-tyaga-prised-gantelya-nad-soboi",
            "name": "Мертвая тяга+присед+гантеля над собой",
            "video_url": "https://youtu.be/9Q8jGHM0pMo",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений каждого упражнения",
            "section": "exercises"
          },
          {
            "slug": "sheet-tyaga-rezinki-za-golovu-2",
            "name": "Тяга резинки за голову",
            "video_url": "https://youtu.be/vPeOAcFIMCg",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-supermen-2",
            "name": "Супермен",
            "video_url": "https://youtu.be/LsB5bvsNY9c",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-zaminka",
            "name": "Заминка",
            "video_url": "https://youtu.be/GxNpcq7ug7I",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "cooldown"
          }
        ]
      },
      {
        "title": "Тренировка №3",
        "focus": "🟩🟩 ТРЕНИРОВКА 3 🟩🟩",
        "items": [
          {
            "slug": "sheet-razminka",
            "name": "Разминка",
            "video_url": "https://youtu.be/7SnqarWw7uo",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "warmup"
          },
          {
            "slug": "sheet-lodochka-plovets",
            "name": "Лодочка + Пловец",
            "video_url": "https://youtu.be/qZJc4fXJFj0",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений каждого упражнения",
            "section": "exercises"
          },
          {
            "slug": "sheet-prisedaniya-s-aktsentom-na-odnu-nogu",
            "name": "Приседания с акцентом на 1 ногу",
            "video_url": "https://youtu.be/CV3Pz0AxBag",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-yagodichnyi-most-s-razvedeniem",
            "name": "Ягодичный мост с разведением",
            "video_url": "https://youtu.be/yyOopPWcPsU",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-razvedenie-nog-s-pola",
            "name": "Разведение ног с пола",
            "video_url": "https://youtu.be/-vnLGWQ9yds",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-press-iz-polozheniya-lodki",
            "name": "Пресс из положения лодки",
            "video_url": "https://youtu.be/7I9tTEvvoPQ",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-skruchivaniya-spina",
            "name": "Скручивания",
            "video_url": "https://youtu.be/pw9tpaTZbkc",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-zaminka",
            "name": "Заминка",
            "video_url": "https://youtu.be/GxNpcq7ug7I",
            "sets": 1,
            "reps": "по видео",
            "rest_seconds": 0,
            "note": "1 подход по 15 повторений каждого упражнения",
            "section": "cooldown"
          }
        ]
      }
    ]
  },
  {
    "weekIndex": 1,
    "workouts": [
      {
        "title": "Тренировка №2",
        "focus": "ТРЕНИРОВКА 2",
        "items": [
          {
            "slug": "sheet-lodochka-gusenitsa-setapy-2",
            "name": "Лодочка+Гусеница+Сетапы",
            "video_url": "https://youtu.be/P6_Cxg8yREg",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-razvedenie-nog-na-polu",
            "name": "Супермен+Планка+Пресс",
            "video_url": "https://youtu.be/MJgU8H2qz50",
            "sets": 4,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "4 подхода по 15- 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-russkii-tvist-s-nogami-na-vesu-2",
            "name": "Русский твист с ногами на весу",
            "video_url": "https://youtu.be/CQmaOisYZ5g",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          }
        ]
      },
      {
        "title": "Тренировка №3",
        "focus": "🟩🟩 ТРЕНИРОВКА 3 🟩🟩",
        "items": [
          {
            "slug": "sheet-uprazhnenie-7eknssuhvbi",
            "name": "Упражнение 7EKNSsuhvBI",
            "video_url": "https://youtu.be/7EKNSsuhvBI",
            "sets": 3,
            "reps": "20 сек",
            "rest_seconds": 45,
            "note": "20 сек работы/20 сек отдыха",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-oxlx0wzyqmw",
            "name": "Упражнение OXlx0wZYqmw",
            "video_url": "https://youtu.be/OXlx0wZYqmw",
            "sets": 3,
            "reps": "20 сек",
            "rest_seconds": 45,
            "note": "20 сек работы/20 сек отдыха",
            "section": "exercises"
          },
          {
            "slug": "sheet-mahi-cherez-storony-poperemenno",
            "name": "Махи гантелями попеременно",
            "video_url": "https://youtu.be/jhh_fbWK3s0",
            "sets": 3,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "3 подхода по 15 -20 повторений",
            "section": "exercises"
          }
        ]
      }
    ]
  },
  {
    "weekIndex": 2,
    "workouts": [
      {
        "title": "Тренировка №1",
        "focus": "ТРЕНИРОВКА 1",
        "items": [
          {
            "slug": "sheet-tyaga-amortizatora-sidya-na-stule-2",
            "name": "Тяга амортизатора сидя на стуле",
            "video_url": "https://youtu.be/ToARC67MShM",
            "sets": 4,
            "reps": "12",
            "rest_seconds": 45,
            "note": "4 подхода по 12 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-razgibaniya-na-tritseps-v-naklone-2",
            "name": "Разгибания на трицепс в наклоне",
            "video_url": "https://youtu.be/DzRKrw_W5wU",
            "sets": 3,
            "reps": "15",
            "rest_seconds": 45,
            "note": "3 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-tyaga-ganteli-k-poyasu-v-upore-na-stul",
            "name": "Тяга гантели к поясу в упоре на стул",
            "video_url": "https://youtu.be/0KrlBBinq3A",
            "sets": 4,
            "reps": "12",
            "rest_seconds": 45,
            "note": "4 подхода по 12 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-razvodka-gantelei-lezha-2",
            "name": "Разводка гантелей лежа",
            "video_url": "https://youtu.be/tbIvoKvl5_k",
            "sets": 3,
            "reps": "15",
            "rest_seconds": 45,
            "note": "3 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-russkii-tvist-s-nogami-na-vesu-2",
            "name": "Сетапы",
            "video_url": "https://youtu.be/CQmaOisYZ5g",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          }
        ]
      },
      {
        "title": "Тренировка №2",
        "focus": "ноги/ягодицы/плечи/пресс",
        "items": [
          {
            "slug": "sheet-otvedenie-taza-s-zakruchivaniyami",
            "name": "Отведение таза с закручиваниями",
            "video_url": "https://youtu.be/-WqIZdpGYCw",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-press-s-gantelei-2",
            "name": "Пресс с гантелей",
            "video_url": "https://youtu.be/Va5y2p5N1UU",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-prised-podem-ganteli-nad-golovoy",
            "name": "Присед+подъем гантели над головой",
            "video_url": "https://youtu.be/NiGdC-sNKBs",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-trastery",
            "name": "Трастеры",
            "video_url": "https://youtu.be/RbOJZZlyJXI",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-pronatsiya-gantel-i-podem-gantel-nad-golovoy",
            "name": "Пронация гантель + подъем над головой",
            "video_url": "https://youtu.be/LbFko1s3v2E",
            "sets": 4,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "4 подхода по 15-20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-mahi-gantel-sidya-na-stule",
            "name": "махи гантель сидя на стуле",
            "video_url": "https://youtu.be/cu-ptaFHpRQ",
            "sets": 4,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "4 подхода по 15-20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-eo-zdto3fro",
            "name": "Упражнение eo_ZdTo3FRo",
            "video_url": "https://youtu.be/eo_ZdTo3FRo",
            "sets": 3,
            "reps": "20 сек",
            "rest_seconds": 45,
            "note": "20 сек работы/20 сек отдыха",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-pqjvdfkv3y4",
            "name": "Упражнение pQjvdfkv3Y4",
            "video_url": "https://youtu.be/pQjvdfkv3Y4",
            "sets": 3,
            "reps": "20 сек",
            "rest_seconds": 45,
            "note": "20 сек работы/20 сек отдыха",
            "section": "exercises"
          },
          {
            "slug": "sheet-frantsuzskiy-zhim-gantel-sidya",
            "name": "французский жим гантель сидя",
            "video_url": "https://youtu.be/8k6p7QQ968Y",
            "sets": 3,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "3 подхода по 15-20 повторений",
            "section": "exercises"
          }
        ]
      }
    ]
  },
  {
    "weekIndex": 3,
    "workouts": [
      {
        "title": "Тренировка №1",
        "focus": "спина/ягодицы/пресс",
        "items": [
          {
            "slug": "sheet-zashagivanie-na-stul",
            "name": "Зашагивание на стул",
            "video_url": "https://youtu.be/Gn_r6BxobCc",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений на ногу",
            "section": "exercises"
          },
          {
            "slug": "sheet-razvedenie-nog-s-rezinkoy",
            "name": "Разведение ног с резинкой",
            "video_url": "https://youtu.be/dmbbgg97rh0",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-tyaga-rezinki-za-golovu",
            "name": "Тяга резинки за голову",
            "video_url": "https://youtu.be/n9gehjlHPSo",
            "sets": 3,
            "reps": "15",
            "rest_seconds": 45,
            "note": "3 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-tyaga-ganteli-k-poyasu-v-upore-na-stul-2",
            "name": "Тяга гантели к поясу в упоре на стул",
            "video_url": "https://youtu.be/i2cgqkHbZ84",
            "sets": 3,
            "reps": "15",
            "rest_seconds": 45,
            "note": "3 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-russkii-tvist-s-nogami-na-vesu-2",
            "name": "Сетапы",
            "video_url": "https://youtu.be/CQmaOisYZ5g",
            "sets": 3,
            "reps": "25",
            "rest_seconds": 45,
            "note": "3 подхода по 25 повторений",
            "section": "exercises"
          }
        ]
      },
      {
        "title": "Тренировка №2",
        "focus": "ТРЕНИРОВКА 2",
        "items": [
          {
            "slug": "sheet-yagodichnyy-mostik-s-rezinkoy",
            "name": "Ягодичный мостик с резинкой",
            "video_url": "https://youtu.be/NMDFRwwkELs",
            "sets": 4,
            "reps": "20",
            "rest_seconds": 45,
            "note": "4 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-razvedenie-nog-na-polu",
            "name": "Супермен+Планка+Пресс",
            "video_url": "https://youtu.be/MJgU8H2qz50",
            "sets": 3,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "3 подхода по 15- 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-mjiwfarw-oq",
            "name": "Упражнение MjIwfarW_OQ",
            "video_url": "https://youtu.be/MjIwfarW_OQ",
            "sets": 4,
            "reps": "15",
            "rest_seconds": 45,
            "note": "4 подхода по 15 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-dbpjyr7d8by",
            "name": "Упражнение dbPjyr7D8bY",
            "video_url": "https://youtu.be/dbPjyr7D8bY",
            "sets": 4,
            "reps": "15-20",
            "rest_seconds": 45,
            "note": "4 подхода по 15- 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-uprazhnenie-qrcrb1fzetu",
            "name": "Упражнение QrCrB1FzetU",
            "video_url": "https://youtu.be/QrCrB1FzetU",
            "sets": 3,
            "reps": "30 сек",
            "rest_seconds": 45,
            "note": "3 подхода по 30 сек",
            "section": "exercises"
          },
          {
            "slug": "sheet-podem-ganteli-otvedenie-nogi",
            "name": "подъем гантели+отведение ноги",
            "video_url": "https://youtu.be/LCJPmATeBY8",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-trastery-2",
            "name": "Трастеры",
            "video_url": "https://youtu.be/A8UXw0VHHJg",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-vybros-giri-pered-soboy-2",
            "name": "Выброс гири перед собой",
            "video_url": "https://youtu.be/p3DBAX8jaNA",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          },
          {
            "slug": "sheet-tyaga-rezinki-sidya-na-stule-2",
            "name": "Тяга резинки сидя на стуле",
            "video_url": "https://youtu.be/GL142CtSnUE",
            "sets": 3,
            "reps": "20",
            "rest_seconds": 45,
            "note": "3 подхода по 20 повторений",
            "section": "exercises"
          }
        ]
      }
    ]
  }
] as const;
