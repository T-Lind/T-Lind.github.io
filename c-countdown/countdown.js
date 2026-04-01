(function() {
    const targetDate = new Date('2026-08-17T10:00:00-05:00'); // Central Daylight Time (UTC-5)
    
    const elements = {
        months: document.getElementById('months'),
        weeks: document.getElementById('weeks'),
        days: document.getElementById('days'),
        hours: document.getElementById('hours'),
        minutes: document.getElementById('minutes'),
        seconds: document.getElementById('seconds'),
        wrapper: document.getElementById('countdown-wrapper'),
        expired: document.getElementById('expired')
    };

    function update() {
        const now = new Date();
        const diffInMs = targetDate - now;

        if (diffInMs <= 0) {
            elements.wrapper.style.display = 'none';
            elements.expired.style.display = 'block';
            return;
        }

        // Calculation Strategy:
        // 1. Count full months between now and target.
        // 2. Use remainder to count weeks.
        // 3. Use remainder to count days, hours, etc.

        let tempDate = new Date(now.getTime());
        let totalMonths = 0;

        // Add months until we exceed or match the target month/day
        while (true) {
            let nextMonth = new Date(tempDate.getTime());
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            
            if (nextMonth <= targetDate) {
                tempDate = nextMonth;
                totalMonths++;
            } else {
                break;
            }
        }

        let remainingMs = targetDate - tempDate;

        const msPerSecond = 1000;
        const msPerMinute = msPerSecond * 60;
        const msPerHour = msPerMinute * 60;
        const msPerDay = msPerHour * 24;
        const msPerWeek = msPerDay * 7;

        const weeks = Math.floor(remainingMs / msPerWeek);
        remainingMs %= msPerWeek;

        const days = Math.floor(remainingMs / msPerDay);
        remainingMs %= msPerDay;

        const hours = Math.floor(remainingMs / msPerHour);
        remainingMs %= msPerHour;

        const minutes = Math.floor(remainingMs / msPerMinute);
        remainingMs %= msPerMinute;

        const seconds = Math.floor(remainingMs / msPerSecond);

        // Update UI
        elements.months.textContent = pad(totalMonths);
        elements.weeks.textContent = pad(weeks);
        elements.days.textContent = pad(days);
        elements.hours.textContent = pad(hours);
        elements.minutes.textContent = pad(minutes);
        elements.seconds.textContent = pad(seconds);

        // Extra Spice: Random data flux for 'cool' factor
        const fluxElement = document.getElementById('status-flux');
        if (fluxElement && Math.random() > 0.8) {
            const randomHex = Math.floor(Math.random()*16777215).toString(16).toUpperCase().padStart(6, '0');
            fluxElement.textContent = `0x${randomHex}`;
        }
    }

    function pad(n) {
        return n < 10 ? '0' + n : n;
    }

    update();
    setInterval(update, 1000);
})();
