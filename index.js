function gridCellDimensions() {
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.height = "var(--line-height)";
    element.style.width = "1ch";
    document.body.appendChild(element);
    const rect = element.getBoundingClientRect();
    document.body.removeChild(element);
    return {width: rect.width, height: rect.height};
}

// Add padding to each media to maintain grid.
function adjustMediaPadding() {
    const cell = gridCellDimensions();

    function setHeightFromRatio(media, ratio) {
        const rect = media.getBoundingClientRect();
        const realHeight = rect.width / ratio;
        const diff = cell.height - (realHeight % cell.height);
        media.style.setProperty("padding-bottom", `${diff}px`);
    }

    function setFallbackHeight(media) {
        const rect = media.getBoundingClientRect();
        const height = Math.round((rect.width / 2) / cell.height) * cell.height;
        media.style.setProperty("height", `${height}px`);
    }

    function onMediaLoaded(media) {
        var width, height;
        switch (media.tagName) {
            case "IMG":
                width = media.naturalWidth;
                height = media.naturalHeight;
                break;
            case "VIDEO":
                width = media.videoWidth;
                height = media.videoHeight;
                break;
        }
        if (width > 0 && height > 0) {
            setHeightFromRatio(media, width / height);
        } else {
            setFallbackHeight(media);
        }
    }

    const medias = document.querySelectorAll("img, video");
    for (media of medias) {
        switch (media.tagName) {
            case "IMG":
                if (media.complete) {
                    onMediaLoaded(media);
                } else {
                    media.addEventListener("load", () => onMediaLoaded(media));
                    media.addEventListener("error", function () {
                        setFallbackHeight(media);
                    });
                }
                break;
            case "VIDEO":
                switch (media.readyState) {
                    case HTMLMediaElement.HAVE_CURRENT_DATA:
                    case HTMLMediaElement.HAVE_FUTURE_DATA:
                    case HTMLMediaElement.HAVE_ENOUGH_DATA:
                        onMediaLoaded(media);
                        break;
                    default:
                        media.addEventListener("loadeddata", () => onMediaLoaded(media));
                        media.addEventListener("error", function () {
                            setFallbackHeight(media);
                        });
                        break;
                }
                break;
        }
    }
}

adjustMediaPadding();
window.addEventListener("load", adjustMediaPadding);
window.addEventListener("resize", adjustMediaPadding);

function checkOffsets() {
    const ignoredTagNames = new Set([
        "THEAD",
        "TBODY",
        "TFOOT",
        "TR",
        "TD",
        "TH",
    ]);
    const cell = gridCellDimensions();
    const elements = document.querySelectorAll("body :not(.debug-grid, .debug-toggle)");
    for (const element of elements) {
        if (ignoredTagNames.has(element.tagName)) {
            continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            continue;
        }
        const top = rect.top + window.scrollY;
        const left = rect.left + window.scrollX;
        const offset = top % (cell.height / 2);
        if (offset > 0) {
            element.classList.add("off-grid");
            console.error("Incorrect vertical offset for", element, "with remainder", top % cell.height, "when expecting divisible by", cell.height / 2);
        } else {
            element.classList.remove("off-grid");
        }
    }
}

const debugToggle = document.querySelector(".debug-toggle");

function onDebugToggle() {
    document.body.classList.toggle("debug", debugToggle.checked);
}

// debugToggle.addEventListener("change", onDebugToggle);

const delays = [
    600,
    900,
    1000,
    1100,
    3800,
    1000,
    1600,
    1000,
    1500,
    1000,
]

function typeIntroduction() {
    const container = document.getElementById('typing-container');
    const text = `Well hi there!

This site has all sorts of stuff about me because, I don't know, I felt like it?

It includes my profile & a few patent-pending inventions and research papers I've written.

There's also some other interesting stuff here. Have fun exploring!

`;

    let index = 0;
    let newLineIndex = 0;

    // Add the ">" symbol at the beginning
    container.innerHTML = '&gt; ';

    function typeNextCharacter() {
        if (index < text.length) {
            if (text[index] === '\n' && text[index + 1] === '\n') {
                container.innerHTML += '<br><br>';
                index += 2;
                newLineIndex++;
            } else if (text[index] === '*') {
                const endIndex = text.indexOf('*', index + 1);
                if (endIndex !== -1) {
                    const emphasis = text.slice(index + 1, endIndex);
                    container.innerHTML += `<em>${emphasis}</em>`;
                    index = endIndex + 1;
                } else {
                    container.innerHTML += text[index];
                    index++;
                }
            } else {
                container.innerHTML += text[index];
                index++;
            }
            if (text[index] === '\n') {
                setTimeout(typeNextCharacter, Math.random() * 100 + delays[newLineIndex]);
            } else {
                setTimeout(typeNextCharacter, Math.random() * 10 + 9);
            }
        } else {
            container.innerHTML += '<span class="cursor">\|</span>';
        }
    }

    if (!localStorage.getItem('typingEffectShown')) {
        typeNextCharacter();
        localStorage.setItem('typingEffectShown', 'true');
    } else {
        container.innerHTML = '&gt; ' + text.replace(/\n/g, '<br>') + '<span class="cursor">\|</span>';
    }
}

window.addEventListener('load', typeIntroduction);

// const yesButton = document.getElementById('yes-button');
// const noButton = document.getElementById('no-button');
// const resultDiv = document.getElementById('button-result');
//
// // Add click event listener to the "Yes" button
// yesButton.addEventListener('click', function() {
//     // redirect to /puzzles
//     window.location.href = "/puzzles";
// });
//
// // Add click event listener to the "No" button
// noButton.addEventListener('click', function() {
//     resultDiv.textContent = "Then why exactly did you click this?";
// });
//
// const doSomething = document.getElementById('do-something-button');
//
// doSomething.addEventListener('click', function() {
//     console.log("Okay, well this is good.");
// });
