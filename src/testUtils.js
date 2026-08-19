import { test } from '@playwright/test';

let closePopups = async function(page) {}

function setClosePopups(f) {
    closePopups = f;
}

let baseUrl = '';
function setBaseUrl(url) {
    baseUrl = url;
}

test.beforeEach(async ({ context }) => {
    startTimer();
    logTimestamp('Test execution started');
    await context.route('**/*', route => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname.toLowerCase();
        if (req.method() !== 'GET' || path.includes('/wp-content/') || !path.includes(baseUrl)) {
            return route.continue();
        }
        url.searchParams.set('_cb', Date.now().toString());
        const urlString = url.toString();
        logTimestamp('Requesting ' + urlString);
        route.continue({ url: urlString });
    });
});

let testStartTime = null;
function startTimer() {
    testStartTime = new Date();

	logTimestamp(`Test started at: ${testStartTime.toISOString()}`);

    return testStartTime;
}

function logTimestamp(eventName) {
    if (!testStartTime) {
        startTimer();
    }
    
    const currentTime = new Date();
    const elapsedMs = currentTime - testStartTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(3);
    
    const logMessage = `[${currentTime.toISOString()}] ${eventName} - ${elapsedSec}s elapsed\n`;
    console.log(logMessage.trim());
    
    return { currentTime, elapsedMs, elapsedSec };
}

async function waitForCompleteLoad(page) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
}


async function click(page, locator) {
	await waitForCompleteLoad(page);
    await closePopups(page);
    await rehover(page);
	const success = await highlightedClick(page, locator);
	await waitForCompleteLoad(page);
	await page.waitForTimeout(500);
	await closePopups(page);
    if (!success) {
        await highlightedClick(page, locator);
        await page.waitForTimeout(500);
        await closePopups(page);
    }
}

async function highlightedClick(page, locator) {
    const isInViewport = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;
        
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= windowHeight &&
            rect.right <= windowWidth
       );
    });
    
    if (!isInViewport) {
        const elementPosition = await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top + window.scrollY,
                height: rect.height
            };
        });
        
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const targetScrollY = elementPosition.top - (viewportHeight / 2) + (elementPosition.height / 2);
        
        const maxScrollY = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
        const finalScrollY = Math.max(0, Math.min(targetScrollY, maxScrollY));
        
        logTimestamp(`Element not in viewport, scrolling to position: ${finalScrollY}`);
        await page.evaluate((scrollY) => window.scrollTo(0, scrollY), finalScrollY);
        await page.waitForTimeout(500);
    } 
    try {
        await closePopups(page);
        await locator.click({ force: true });
        logTimestamp('clicking ' + locator);
        return true;
    } catch (error) {
        logTimestamp(`Error clicking on locator: ${locator} ${error.message}`);
        return false;
    }
}

let hoveredLocator = null;

async function hover(page, locator) {
    hoveredLocator = locator;
    
    try {
        await locator.hover();
        logTimestamp('hovering ' + locator);
        return true;
    } catch (error) {
        logTimestamp(`Error hovering on locator: ${locator} ${error.message}`);
        return false;
    }
}

async function rehover(page) {
    if (hoveredLocator) {
        await hover(page, hoveredLocator);
        hoveredLocator = null;
    }
}

async function scrollToTopOfElement(page, target, offset = 0) {
    const locator = typeof target === 'string' ? page.locator(target) : target;
    await locator.waitFor({ state: 'attached' });

    const targetScrollY = await locator.evaluate((element, scrollOffset) => {
        const rect = element.getBoundingClientRect();
        return rect.top + window.scrollY - scrollOffset;
    }, offset);

    const maxScrollY = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    const finalScrollY = Math.max(0, Math.min(targetScrollY, maxScrollY));

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), finalScrollY);
    await page.waitForTimeout(500);
    logTimestamp(`Scrolled to position: ${finalScrollY}`);

    return finalScrollY;
}

async function fill(page, field, value) {
    let locator;
    if (typeof field === 'string') {
        const selector = `input[name="${field}"]`;
        locator = page.locator(selector);
    } else {
        locator = field;
    }
    await click(page, locator);
    await locator.fill(value);
    
}

async function selectOption(page, field, value) {
    let locator;
    if (typeof field === 'string') {
        const selector = `select[name="${field}"]`;
        locator = page.locator(selector);
    } else {
        locator = field;
    }
    await click(page, locator);
    await locator.selectOption({ label: value });
    logTimestamp('selecting ' + value + ' on ' + locator);
    await page.waitForTimeout(500);
}

export {
    waitForCompleteLoad,
    highlightedClick,
    click,
    hover,
    fill,
    selectOption,
    rehover,
    scrollToTopOfElement,
    setClosePopups,
    logTimestamp,
    setBaseUrl
};