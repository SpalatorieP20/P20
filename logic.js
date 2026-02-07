import { utils } from './utils.js';
import { MACHINES, BOOKING_LIMIT } from './config.js';

export const logic = {
    machines: MACHINES,
    
    generateSlots(startHour = 0, endHour = 24) {
        const slots = [];
        for (let h = startHour; h < endHour; h++) { 
            slots.push(`${h.toString().padStart(2, '0')}:00`); 
            slots.push(`${h.toString().padStart(2, '0')}:30`); 
        }
        return slots;
    },

    isSlotFree(machine, date, start, duration, bookings) {
        const sameDayBookings = bookings.filter(b => b.machineType === machine && b.date === date);
        const reqStart = utils.timeToMins(start);
        const reqEnd = reqStart + parseInt(duration);
        
        const overlapSameDay = sameDayBookings.some(b => {
            const bStart = utils.timeToMins(b.startTime);
            const bEnd = bStart + parseInt(b.duration);
            return (reqStart < bEnd && reqEnd > bStart);
        });

        if (overlapSameDay) return false;

        const prevDate = utils.addDays(date, -1);
        const prevDayBookings = bookings.filter(b => b.machineType === machine && b.date === prevDate);
        
        const overlapPrevDay = prevDayBookings.some(b => {
            const bStart = utils.timeToMins(b.startTime);
            const bDuration = parseInt(b.duration);
            const bEndTotal = bStart + bDuration; 
            
            if (bEndTotal > 1440) { 
                const spillEnd = bEndTotal - 1440; 
                return reqStart < spillEnd;
            }
            return false;
        });

        return !overlapPrevDay;
    },

    canUserBook(userName, bookings) {
        const limit = BOOKING_LIMIT; 
        const today = new Date().toISOString().split('T')[0];
        const userBookings = bookings.filter(b => 
            b.userName.toLowerCase() === userName.toLowerCase() && b.date >= today
        );
        return userBookings.length < limit;
    }
};
